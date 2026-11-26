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

TRACK = 'octane/t111_crash_cove/t111_crash_cove'


class CraftTests(unittest.TestCase):
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
