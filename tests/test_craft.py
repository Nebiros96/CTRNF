import tempfile
import json
import threading
import unittest
import urllib.error
import urllib.request
from pathlib import Path
from unittest.mock import patch

import craft
import time_trial_gui as gui
import time_trial_logger as core

TRACK = 'octane/t111_crash_cove/t111_crash_cove'


class CraftTests(unittest.TestCase):
    def test_nine_levels_round_previous_cost_and_preserve_existing_unlock(self):
        _, rules = craft.catalog()
        official = [track for track in rules['tracks'] if track['unlock']]
        self.assertEqual(len(official), 40)
        track = official[0]
        self.assertEqual([r['quantity'] for r in craft.requirements(track, 2)], [83, 33, 6, 2, 20])
        self.assertEqual(craft.requirements(track, 10), [])
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'crates.csv'
            rows = [{'kind': 'earn', 'crate_id': r['crate_id'], 'amount': 10000, 'track': '', 'race_key': ''} for r in track['unlock']['requirements']]
            # A legacy unlock row must still represent level one.
            rows.append({'kind': 'unlock', 'crate_id': '', 'amount': 0, 'track': TRACK, 'race_key': ''})
            craft.write(path, rows)
            self.assertEqual(craft.state(path)['levels'][TRACK], 1)
            for level in range(2, 10):
                before = craft.state(path)['inventory'].copy()
                state = craft.unlock(path, 1)
                self.assertEqual(state['levels'][TRACK], level)
                for req in craft.requirements(track, level):
                    self.assertEqual(before[req['crate_id']] - state['inventory'][req['crate_id']], req['quantity'])
            before = craft.read(path)
            with self.assertRaises(ValueError):
                craft.unlock(path, 1)
            self.assertEqual(craft.read(path), before)

    def test_platinum_doubles_independent_lootboxes_in_both_modes(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'crates.csv'
            craft.write(path, [{'kind': 'unlock', 'crate_id': '', 'amount': 0, 'track': TRACK, 'race_key': ''} for _ in range(9)])
            self.assertEqual(len(craft.award(path, TRACK, 'rally_ring', 'rr:1', laps=9)), 6)
            self.assertEqual(len(craft.award(path, TRACK, 'time_trial', 'tt:1')), 2)
            self.assertEqual(craft.award(path, TRACK, 'rally_ring', 'rr:1', laps=9), [])
            self.assertEqual(craft.award(path, TRACK, 'rally_ring', 'rr:2', laps=4), [])

    def test_skin_bonuses_accumulate_across_tracks_and_only_apply_to_unlocked_skins(self):
        catalog = core.load_rally_catalog()
        cnk = [track for track, row in catalog['tracks'].items() if row['track_game'] == 'Crash Nitro Kart'][:3]
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'crates.csv'
            craft.write(path, [{'kind': 'unlock', 'crate_id': '', 'amount': 0, 'track': track, 'race_key': ''} for track in cnk for _ in range(6)])
            with patch.object(core, 'RALLY_RING_CSV_PATH', Path(directory) / 'rally_ring.csv'):
                bonuses = core._workshop_skin_bonuses(catalog)
            for rarity in ('legendary', 'exotic', 'basic'):
                self.assertEqual(bonuses['crash nitro kart', rarity], 3)
            cnk_id = catalog['characters_by_game']['crash nitro kart'][0]
            ctr_id = catalog['characters_by_game']['crash team racing'][0]
            points = {cnk_id: 0, ctr_id: 10**12}
            self.assertEqual(core._milli_for_points(catalog, points, bonuses), core._milli_for_points(catalog, points))
            points[cnk_id] = 10**12
            steps = catalog['ladders'][cnk_id]
            eligible = sum(s['skin_type'].casefold() in ('legendary', 'exotic', 'basic') for s in steps)
            self.assertEqual(core._milli_for_points(catalog, points, bonuses) - core._milli_for_points(catalog, points), 3 * eligible)

    def test_new_skin_receives_existing_workshop_bonus_in_same_race(self):
        catalog = core.load_rally_catalog()
        catalog['achievements'] = []
        character = catalog['characters_by_game']['crash nitro kart'][0]
        skin = catalog['ladders'][character][0]['skin']
        with patch.object(core, '_apply_time_trials'), patch.object(core, '_store_milli_for_skin', return_value=0), \
             patch.object(core, '_store_global_milli', return_value=0):
            result = core.score_with_progression([], skin, 500000, catalog,
                workshop_bonuses={('crash nitro kart', 'basic'): 3})
        self.assertEqual(result['multiplier'], '0.004')
        self.assertEqual(result['score_mult'], 502000)

    def test_ring_rally_and_coin_levels_replace_previous_values(self):
        self.assertEqual(craft.RALLY_BONUS_MILLI, (0, 20, 30, 40, 40, 50, 60, 60, 80, 100))
        self.assertEqual([craft.coin_multiplier(level) for level in range(10)],
                         ['1'] * 7 + ['1.5', '1.75', '2'])

    def test_coin_track_bonus_uses_base_independently_of_store(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'crates.csv'
            craft.write(path, [{'kind': 'unlock', 'crate_id': '', 'amount': 0, 'track': TRACK, 'race_key': ''} for _ in range(8)])
            item = {'id': 'store', 'bonus_coins': core.Decimal('2'), 'bonus_coins_flat': 0}
            for mode in ('time_trial', 'rally_ring'):
                with self.subTest(mode=mode), patch.object(core, 'RALLY_RING_CSV_PATH', Path(directory) / 'rally_ring.csv'), \
                     patch.object(core, '_read_wallet', return_value=[{'kind': 'buy', 'item_id': 'store'}]), \
                     patch.object(core, '_write_wallet'), patch.object(core, '_load_store_items', return_value=[item]), \
                     patch.object(core, '_track_catalog_row', return_value={'tt_wumpas': '40', 'rr_wumpas': '40'}), \
                     patch.object(core.random, 'random', return_value=1):
                    detail = {}
                    self.assertEqual(core.credit_race_coins(mode, '1', TRACK, '2026-11-18', detail), 110)
                    self.assertEqual(detail['track_bonus'], 30)
                    weekend = {}
                    self.assertEqual(core.credit_race_coins(mode, '2', TRACK, '2026-11-21', weekend), 150)
                    self.assertEqual(weekend['multiplier_bonus'], 40)
                    self.assertEqual(weekend['track_bonus'], 30)
    def test_infinity_unlock_requirements_reflect_its_rarity(self):
        _, rules = craft.catalog()
        requirements = [(track['name'], requirement['quantity'])
                        for track in rules['tracks']
                        for requirement in (track['unlock'] or {}).get('requirements', [])
                        if requirement['crate_id'] == 'infinity']
        self.assertEqual(len(requirements), 7)
        self.assertTrue(all(quantity == 5 for _, quantity in requirements))

    def test_crate_selection_probabilities_are_balanced_on_every_track(self):
        _, rules = craft.catalog()
        for track in rules['tracks']:
            tables = []
            for tier in ('neither', 'velo_only', 'dev_beaten'):
                tables.append({drop['crate_id']: drop['time_trial']['tiers'][tier]['selection_probability']
                               for drop in track['crate_drops']})
            tables.extend(row['probabilities'] for row in
                          track['race_rewards']['ring_rally'].get('selection_probabilities_by_lap', []))
            for probabilities in tables:
                with self.subTest(track=track['name'], probabilities=probabilities):
                    self.assertAlmostEqual(sum(probabilities.values()), 1.0)
                    self.assertTrue(all(value > 0 for value in probabilities.values()))
                    self.assertGreater(probabilities['basic'], probabilities['tnt'])
                    self.assertGreater(probabilities['aku_aku'], probabilities['iron_aku_aku'])

        tt = {drop['crate_id']: drop['time_trial']['tiers']['neither']['selection_probability']
              for drop in rules['tracks'][0]['crate_drops']}
        for crate_id, previous in {'aku_aku': 0.0537, 'life': 0.06, 'slot': 0.0387, 'time': 0.0387}.items():
            self.assertGreater(tt[crate_id], previous)
        self.assertLess(tt['infinity'], 0.06)

    def test_rewards_are_saved_once_and_below_five_laps_give_nothing(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'crates.csv'
            rewards = craft.award(path, TRACK, 'rally_ring', 'rally_ring:1', laps=9)
            self.assertEqual(len(rewards), 3)
            self.assertEqual(sum(craft.state(path)['inventory'].values()), sum(item['quantity'] for item in rewards))
            self.assertEqual(craft.award(path, TRACK, 'rally_ring', 'rally_ring:1', laps=9), [])
            self.assertEqual(craft.award(path, TRACK, 'rally_ring', 'rally_ring:2', laps=4), [])
            self.assertEqual(len(craft.award(path, TRACK, 'time_trial', 'time_trial:1', tier='dev_beaten')), 1)

    def test_weekend_doubles_crate_quantities_in_both_modes(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'crates.csv'
            with patch.object(craft.random, 'choices', return_value=['bounce']), patch.object(craft.random, 'randint', return_value=3):
                for mode in ('time_trial', 'rally_ring'):
                    for day, expected in (('2026-11-19', 3), ('2026-11-20', 6), ('2026-11-21', 6), ('2026-11-22', 6), ('2026-11-23', 3)):
                        rewards = craft.award(path, TRACK, mode, f'{mode}:{day}', laps=5,
                                              quantity_multiplier=core._weekend_wumpa_multiplier(day))
                        self.assertTrue(rewards)
                        self.assertTrue(all(reward['quantity'] == expected for reward in rewards))
                self.assertEqual(craft.state(path)['inventory']['bounce'], 48)

    def test_bounce_weight_increases_without_changing_other_weights(self):
        _, rules = craft.catalog()
        track = next(t for t in rules['tracks'] if t['track'] == TRACK)
        for mode in ('time_trial', 'rally_ring'):
            with tempfile.TemporaryDirectory() as directory:
                path = Path(directory) / 'crates.csv'
                with patch.object(craft.random, 'choices', return_value=['bounce']) as choices:
                    craft.award(path, TRACK, mode, mode, laps=5)
                ids = choices.call_args.args[0]
                weights = choices.call_args.kwargs['weights']
                actual = dict(zip(ids, weights))
                if mode == 'time_trial':
                    original = {d['crate_id']: d['time_trial']['tiers']['neither']['selection_probability'] for d in track['crate_drops']}
                else:
                    original = next(row['probabilities'] for row in track['race_rewards']['ring_rally']['selection_probabilities_by_lap'] if row['laps'] == 5)
                for crate_id, weight in original.items():
                    self.assertAlmostEqual(actual[crate_id], weight * (1.15 if crate_id == 'bounce' else 1))

    def test_store_expansions_are_independent_and_have_unique_ids(self):
        items = core._load_store_items()
        ids = [item['id'] for item in items]
        self.assertEqual(len(ids), len(set(ids)))
        for item in items:
            if item['id'].startswith('lootbox_expansion_'):
                self.assertFalse(core._condition_matches_race(item['condition'], '1', '1'))
        for owned, expected in ((set(), (0, 0)), ({'lootbox_expansion_1'}, (0, 1)),
                                ({'lootbox_expansion_2'}, (1, 0)),
                                ({'lootbox_expansion_1', 'lootbox_expansion_2'}, (1, 1))):
            with patch.object(core, '_read_wallet', return_value=[]), patch.object(core, '_purchased_ids', return_value=owned):
                self.assertEqual((core.purchased_lootbox_bonus('time_trial'), core.purchased_lootbox_bonus('rally_ring')), expected)

    def test_expansion_respects_lap_threshold_track_level_and_weekend(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'crates.csv'
            with patch.object(craft.random, 'choices', return_value=['basic']), patch.object(craft.random, 'randint', return_value=3):
                self.assertEqual(craft.award(path, TRACK, 'rally_ring', 'below', laps=4, extra_boxes=1), [])
                for mode, laps, expected in (('time_trial', 0, 2), ('rally_ring', 5, 2), ('rally_ring', 9, 4)):
                    rewards = craft.award(path, TRACK, mode, f'{mode}:{laps}', laps=laps, extra_boxes=1, quantity_multiplier=2)
                    self.assertEqual(len(rewards), expected)
                    self.assertTrue(all(reward['quantity'] == 6 for reward in rewards))
                rows = craft.read(path)
                rows.extend({'kind': 'unlock', 'crate_id': '', 'amount': 0, 'track': TRACK, 'race_key': ''} for _ in range(9))
                craft.write(path, rows)
                self.assertEqual(len(craft.award(path, TRACK, 'time_trial', 'max-tt', extra_boxes=1)), 4)
                self.assertEqual(len(craft.award(path, TRACK, 'rally_ring', 'max-rr', laps=9, extra_boxes=1)), 8)

    def test_all_recipes_and_atomic_exchange(self):
        crates, rules = craft.catalog()
        ids = {crate['id'] for crate in crates}
        recipes = rules['crate_exchange']['recipes']
        self.assertEqual(len(recipes), 380)
        self.assertEqual({(r['source_crate_id'], r['target_crate_id']) for r in recipes}, {(a, b) for a in ids for b in ids if a != b})
        lookup = {(r['source_crate_id'], r['target_crate_id']): (r['source_quantity'], r['target_quantity']) for r in recipes}
        self.assertEqual(lookup['basic', 'freeze'], (50, 1))
        self.assertEqual(lookup['time', 'basic'], (1, 5))
        self.assertEqual(lookup['basic', 'time'], (40, 1))
        self.assertEqual(lookup['infinity', 'basic'], (1, 5))
        self.assertTrue(all(1 <= r['target_quantity'] <= 5 and r['source_quantity'] >= 1 for r in recipes))
        values = {c['id']: max(1, min(5, round((99 / c['rarity']) ** 1.75))) for c in crates}
        for recipe in recipes:
            self.assertGreaterEqual(recipe['source_quantity'] * values[recipe['source_crate_id']],
                                    recipe['target_quantity'] * values[recipe['target_crate_id']])
        self.assertFalse(next(c for c in crates if c['id'] == 'infinity')['is_wildcard'])
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'crates.csv'
            craft.write(path, [{'kind': 'earn', 'crate_id': 'basic', 'amount': 50, 'track': '', 'race_key': ''}])
            result = craft.exchange(path, 'basic', 'freeze')
            self.assertEqual((result['inventory']['basic'], result['inventory']['freeze']), (0, 1))
            for source, target in [('basic', 'freeze'), ('freeze', 'freeze'), ('invalid', 'freeze')]:
                with self.assertRaises(ValueError): craft.exchange(path, source, target)
            self.assertEqual(craft.state(path), result)

    def test_multiple_exchanges_are_atomic_and_require_a_positive_integer(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'crates.csv'
            craft.write(path, [{'kind': 'earn', 'crate_id': 'basic', 'amount': 151, 'track': '', 'race_key': ''}])
            initial = craft.state(path)
            for quantity in (0, -1, 1.5, True, '2', None, 4):
                with self.subTest(quantity=quantity), self.assertRaises(ValueError):
                    craft.exchange(path, 'basic', 'freeze', quantity)
                self.assertEqual(craft.state(path), initial)
            result = craft.exchange(path, 'basic', 'freeze', 3)
            self.assertEqual(result['inventory']['basic'], 1)
            self.assertEqual(result['inventory']['freeze'], 3)
            self.assertEqual(result['acquired']['freeze'], 3)
            self.assertEqual(len(craft.read(path)), 3)

    def test_more_than_five_exchanges_allowed_when_inventory_suffices(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'crates.csv'
            craft.write(path, [{'kind': 'earn', 'crate_id': 'time', 'amount': 12, 'track': '', 'race_key': ''}])
            result = craft.exchange(path, 'time', 'basic', 10)
            self.assertEqual(result['inventory']['time'], 2)
            self.assertEqual(result['inventory']['basic'], 50)

    def test_exchange_api_applies_quantity_and_rejects_invalid_input(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'crates.csv'
            craft.write(path, [{'kind': 'earn', 'crate_id': 'basic', 'amount': 151, 'track': '', 'race_key': ''}])
            server = gui.DashboardServer(('127.0.0.1', 0), gui.Handler)
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            try:
                with patch.object(gui, 'craft_inventory_path', return_value=path):
                    thread.start()
                    url = f'http://127.0.0.1:{server.server_port}/api/craft/exchange'
                    def post(quantity):
                        body = json.dumps({'source_crate_id': 'basic', 'target_crate_id': 'freeze', 'quantity': quantity}).encode()
                        request = urllib.request.Request(url, data=body, headers={'Content-Type': 'application/json'})
                        with urllib.request.urlopen(request) as response:
                            return json.load(response)
                    with self.assertRaises(urllib.error.HTTPError) as invalid:
                        post(1.5)
                    self.assertEqual(invalid.exception.code, 400)
                    self.assertEqual(craft.state(path)['inventory']['basic'], 151)
                    result = post(3)
                    self.assertEqual(result['inventory']['basic'], 1)
                    self.assertEqual(result['inventory']['freeze'], 3)
            finally:
                server.shutdown()
                thread.join()
                server.server_close()

    def test_exchange_unlock_and_backup(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / 'source'; source.mkdir()
            dest = root / 'dest'; dest.mkdir()
            path = source / 'crates.csv'
            quantities = {'infinity': 20, 'basic': 75, 'question': 30, 'life': 10, 'freeze': 1, 'check_point': 18}
            craft.write(path, [{'kind': 'earn', 'crate_id': key, 'amount': value, 'track': '', 'race_key': ''} for key, value in quantities.items()])
            self.assertEqual(craft.exchange(path, 'infinity', 'basic')['inventory']['basic'], 80)
            self.assertIn(TRACK, craft.unlock(path, 1)['unlocked'])
            with self.assertRaises(ValueError): craft.unlock(path, 1)
            with self.assertRaises(ValueError): craft.exchange(path, 'infinity', 'freeze')
            profiles = {'profiles': [{'id': '1', 'name': 'Test'}], 'active': '1'}
            with patch.object(gui, 'DATA_FILES', {'crates.csv': path}), patch.object(gui, 'load_profiles', return_value=profiles):
                gui.export_data(root / 'backup.zip')
            with patch.object(gui, 'DATA_FILES', {'crates.csv': dest / 'crates.csv'}):
                self.assertEqual(gui.import_data(root / 'backup.zip'), ['crates.csv'])
                with self.assertRaises(ValueError): gui.import_data(root / 'backup.zip')
            self.assertEqual(craft.state(path), craft.state(dest / 'crates.csv'))


if __name__ == '__main__':
    unittest.main()
