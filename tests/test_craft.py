import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import craft
import time_trial_gui as gui

TRACK = 'octane/t111_crash_cove/t111_crash_cove'


class CraftTests(unittest.TestCase):
    def test_rewards_are_saved_once_and_below_five_laps_give_nothing(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'crates.csv'
            rewards = craft.award(path, TRACK, 'rally_ring', 'rally_ring:1', laps=9)
            self.assertEqual(len(rewards), 3)
            self.assertEqual(sum(craft.state(path)['inventory'].values()), sum(item['quantity'] for item in rewards))
            self.assertEqual(craft.award(path, TRACK, 'rally_ring', 'rally_ring:1', laps=9), [])
            self.assertEqual(craft.award(path, TRACK, 'rally_ring', 'rally_ring:2', laps=4), [])
            self.assertEqual(len(craft.award(path, TRACK, 'time_trial', 'time_trial:1', tier='dev_beaten')), 1)

    def test_exchange_unlock_and_backup(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / 'source'; source.mkdir()
            dest = root / 'dest'; dest.mkdir()
            path = source / 'crates.csv'
            quantities = {'infinity': 4, 'basic': 75, 'question': 30, 'life': 10, 'freeze': 1, 'check_point': 18}
            craft.write(path, [{'kind': 'earn', 'crate_id': key, 'amount': value, 'track': '', 'race_key': ''} for key, value in quantities.items()])
            self.assertEqual(craft.exchange(path, 'basic')['inventory']['basic'], 77)
            self.assertIn(TRACK, craft.unlock(path, 1)['unlocked'])
            with self.assertRaises(ValueError): craft.unlock(path, 1)
            with self.assertRaises(ValueError): craft.exchange(path, 'freeze')
            profiles = {'profiles': [{'id': '1', 'name': 'Test'}], 'active': '1'}
            with patch.object(gui, 'DATA_FILES', {'crates.csv': path}), patch.object(gui, 'load_profiles', return_value=profiles):
                gui.export_data(root / 'backup.zip')
            with patch.object(gui, 'DATA_FILES', {'crates.csv': dest / 'crates.csv'}):
                self.assertEqual(gui.import_data(root / 'backup.zip'), ['crates.csv'])
                with self.assertRaises(ValueError): gui.import_data(root / 'backup.zip')
            self.assertEqual(craft.state(path), craft.state(dest / 'crates.csv'))


if __name__ == '__main__':
    unittest.main()
