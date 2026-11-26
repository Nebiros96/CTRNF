import csv
import json
import os
import tempfile
import threading
import random
import math
import sys
from pathlib import Path

ROOT = Path(getattr(sys, "_MEIPASS", Path(__file__).resolve().parent))
LOCK = threading.RLock()
FIELDS = ('kind', 'crate_id', 'amount', 'track', 'race_key')
MAX_LEVEL = 9
RALLY_BONUS_MILLI = (0, 20, 30, 40, 40, 50, 60, 60, 80, 100)
BOUNCE_WEIGHT_MULTIPLIER = 1.15

def requirements(track, level):
    """Cost of the given level, increasing the previous rounded cost by 10%."""
    if not 1 <= level <= MAX_LEVEL or not track.get('unlock'):
        return []
    result = []
    for item in track['unlock']['requirements']:
        quantity = item['quantity']
        for _ in range(1, level):
            quantity = (quantity * 11 + 9) // 10
        result.append({'crate_id': item['crate_id'], 'quantity': quantity})
    return result

def coin_multiplier(level):
    return ('1', '1.5', '1.75', '2')[max(0, min(3, level - 6))]

def catalog():
    return (json.loads((ROOT / 'data' / 'crates.json').read_text(encoding='utf-8'))['crates'],
            json.loads((ROOT / 'data' / 'track_crate_rules.json').read_text(encoding='utf-8')))

def read(path):
    if not path.exists(): return []
    with path.open(encoding='utf-8-sig', newline='') as f:
        return list(csv.DictReader(f))

def write(path, rows):
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, name = tempfile.mkstemp(prefix='craft-', suffix='.tmp', dir=path.parent)
    try:
        with os.fdopen(fd, 'w', encoding='utf-8', newline='') as f:
            w = csv.DictWriter(f, fieldnames=FIELDS); w.writeheader(); w.writerows(rows)
        os.replace(name, path)
    finally:
        if os.path.exists(name): os.unlink(name)

def state(path):
    rows=read(path); counts={}; acquired={}; levels={}
    for row in rows:
        if row['kind']=='unlock': levels[row['track']] = min(MAX_LEVEL, levels.get(row['track'], 0) + 1)
        elif row['kind'] != 'race':
            amount = int(row['amount'])
            counts[row['crate_id']]=counts.get(row['crate_id'],0)+amount
            if row['kind'] in ('earn', 'exchange') and amount > 0:
                acquired[row['crate_id']] = acquired.get(row['crate_id'], 0) + amount
    return {'inventory':counts,'acquired':acquired,'unlocked':list(levels), 'levels':levels}

def exchange(path, source, target, quantity=1):
    """Atomically exchange a positive whole number of recipe units."""
    with LOCK:
        if type(quantity) is not int or quantity < 1:
            raise ValueError('Exchange quantity must be a positive whole number')
        _, rules = catalog()
        rate = next((r for r in rules['crate_exchange']['recipes']
                     if r['source_crate_id'] == source and r['target_crate_id'] == target), None)
        if rate is None:
            raise ValueError('Invalid exchange recipe')
        rows = read(path)
        cost = rate['source_quantity'] * quantity
        if state(path)['inventory'].get(source, 0) < cost:
            raise ValueError('Not enough crates')
        rows.extend([
            {'kind': 'exchange', 'crate_id': source, 'amount': -cost, 'track': ''},
            {'kind': 'exchange', 'crate_id': target, 'amount': rate['target_quantity'] * quantity, 'track': ''},
        ])
        write(path, rows)
        return state(path)


def unlock(path, track_id):
    with LOCK:
        crates, rules=catalog(); track=next((x for x in rules['tracks'] if str(x['track_id'])==str(track_id)),None)
        if not track: raise ValueError('Invalid track')
        rows=read(path); current=state(path); raw=track['track']
        level = current['levels'].get(raw, 0)
        if level >= MAX_LEVEL: raise ValueError('Track is already at maximum level')
        if not track['race_rewards']['ring_rally']['enabled']: raise ValueError('Ring Rally is not available on this track')
        needed = requirements(track, level + 1)
        if any(current['inventory'].get(r['crate_id'],0)<r['quantity'] for r in needed): raise ValueError('Not enough crates')
        rows.extend({'kind':'spend','crate_id':r['crate_id'],'amount':-r['quantity'],'track':raw} for r in needed)
        rows.append({'kind':'unlock','crate_id':'','amount':0,'track':raw}); write(path,rows)
        return state(path)


def award(path, raw_track, mode, race_key, *, laps=0, tier="neither", quantity_multiplier=1, extra_boxes=0):
    """Award once per new race; a marker also records races that yield no boxes."""
    with LOCK:
        crates, rules = catalog()
        track = next((t for t in rules['tracks'] if t['track'] == raw_track), None)
        if not track: raise ValueError('Track is not in the crate catalog')
        rows = read(path)
        if any(r.get('kind') == 'race' and r.get('race_key') == race_key for r in rows):
            return []
        drops = track['crate_drops']; names = {c['id']: c for c in crates}
        if mode == 'rally_ring':
            rr = track['race_rewards']['ring_rally']
            if not rr['enabled'] or laps < rr['minimum_laps']: count = 0
            else:
                cat = next(x for x in rr['lap_categories'] if laps >= x['minimum_laps'] and (x['maximum_laps'] is None or laps <= x['maximum_laps']))
                count = rules['lootbox_model']['box_count']['ring_rally'][cat['category']]
            if count:
                capped = min(laps, rr['maximum_laps']); ratio = (capped - 5) / (rr['maximum_laps'] - 5)
                weights = next(x['probabilities'] for x in rr['selection_probabilities_by_lap'] if x['laps'] == capped)
                quantities = {d['crate_id']: (d['ring_rally']['at_minimum_laps']['min_quantity'], math.floor(d['ring_rally']['at_minimum_laps']['max_quantity'] + (d['ring_rally']['at_maximum_laps']['max_quantity'] - d['ring_rally']['at_minimum_laps']['max_quantity']) * ratio + 1e-9)) for d in drops}
        else:
            if tier not in ('neither','velo_only','dev_beaten'): raise ValueError('Invalid Time Trial tier')
            count = 1
            weights = {d['crate_id']: d['time_trial']['tiers'][tier]['selection_probability'] for d in drops}
            quantities = {d['crate_id']: (d['time_trial']['tiers'][tier]['min_quantity'], d['time_trial']['tiers'][tier]['max_quantity']) for d in drops}
        if count:
            count += extra_boxes
        if state(path)['levels'].get(raw_track, 0) >= MAX_LEVEL and track.get('unlock'):
            count *= 2
        result = []
        if count:
            weights = dict(weights)
            weights['bounce'] *= BOUNCE_WEIGHT_MULTIPLIER
        for _ in range(count):
            chosen = random.choices(list(weights), weights=list(weights.values()), k=1)[0]
            amount = random.randint(*quantities[chosen]) * quantity_multiplier
            result.append({'crate_id': chosen, 'name': names[chosen]['name'], 'image_url': names[chosen]['image_url'], 'quantity': amount})
            rows.append({'kind':'earn', 'crate_id':chosen, 'amount':amount, 'track':raw_track, 'race_key':race_key})
        rows.append({'kind':'race', 'crate_id':'', 'amount':0, 'track':raw_track, 'race_key':race_key})
        write(path, rows)
        return result
