import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import time_trial_logger as core


class TrophyPointsTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.catalog = core.load_rally_catalog()
        cls.achievements = {a['id']: a for a in cls.catalog['achievements']}
        cls.crash = next(name for name, row in cls.catalog['skin_by_name'].items() if row['character_id'] == '1')

    def test_descriptions_choose_points_and_single_race_exception(self):
        for achievement_id in ('1', '23'):
            self.assertTrue(self.achievements[achievement_id]['base_points_only'])
        for achievement_id in ('2', '3', '25', '26', '27', '28', '29'):
            self.assertFalse(self.achievements[achievement_id]['base_points_only'])
        stats = core._blank_stats()
        core._add_rally_row(stats, {'score': '900000', 'score_mult': '1100000', 'skin': self.crash}, self.catalog)
        self.assertEqual(core._measure_achievement(self.achievements['1'], stats, self.catalog)[0], 900000)
        self.assertEqual(core._measure_achievement(self.achievements['23'], stats, self.catalog)[0], 900000)
        self.assertEqual(core._measure_achievement(self.achievements['2'], stats, self.catalog)[0], 1100000)
        self.assertEqual(core._measure_achievement(self.achievements['25'], stats, self.catalog)[0], 1100000)
        self.assertEqual(core._measure_achievement(self.achievements['29'], stats, self.catalog)[0], 1100000)

    def test_history_dates_use_stored_scores_and_unmatched_skins_count(self):
        rows = [
            {'id': '1', 'score': '200000000', 'score_mult': '250000000', 'skin': self.crash, 'captured_at': '2026-01-01'},
            {'id': '2', 'score': '50000000', 'score_mult': '90000000', 'skin': 'unknown', 'captured_at': '2026-01-02'},
        ]
        original = [r.copy() for r in rows]
        with patch.object(core, '_read_table', return_value=[]):
            trophies = {t['id']: t for t in core.build_trophies(rows, self.catalog)['trophies']}
        self.assertEqual(trophies['2']['current'], 340000000)
        self.assertEqual(trophies['2']['unlocked_at'], '2026-01-02')
        self.assertEqual(trophies['25']['current'], 250000000)
        self.assertEqual(trophies['25']['unlocked_at'], '2026-01-01')
        self.assertEqual(trophies['29']['current'], 250000000)
        self.assertEqual(rows, original)

    def test_new_score_includes_trophy_unlocked_by_multiplied_score(self):
        ach = dict(self.achievements['2'], goal=1000, milli=5)
        catalog = dict(self.catalog, achievements=[ach], ladders={}, characters={}, tracks={})
        with patch.object(core, '_apply_time_trials'), patch.object(core, '_store_milli_for_skin', return_value=0), patch.object(core, '_milli_for_points', return_value=100):
            result = core.score_with_progression([], 'unknown', 910, catalog)
        self.assertEqual(result['multiplier'], '0.105')
        self.assertEqual(result['score_mult'], core.scaled_score(910, 105))
        self.assertTrue(any(u['name'] == ach['name'] for u in result['unlocks']))

    def test_all_skins_trophy_counts_only_explicit_base_categories(self):
        categories = ('Basic', 'Exotic', 'Legendary', 'Beenox', 'Ultra', 'Future')
        catalog = {'ladders': {'1': [
            {'character_id': '1', 'skin_type': category, 'threshold': index + 1, 'bonus_milli': 1}
            for index, category in enumerate(categories)
        ]}}
        stats = core._blank_stats()
        stats['points_by']['1'] = 4
        trophy = self.achievements['13']
        self.assertEqual(core._measure_achievement(trophy, stats, catalog), (4, 4))
        state, _ = core._achievement_state(stats, dict(catalog, achievements=[trophy]))
        self.assertTrue(state['13']['unlocked'])
        self.assertEqual(core._skin_counts(catalog, stats['points_by']), (4, 6))
        stats['points_by']['1'] = 3
        self.assertEqual(core._measure_achievement(trophy, stats, catalog), (3, 4))

    def test_missing_multiplied_score_falls_back_to_base(self):
        stats = core._blank_stats()
        core._add_rally_row(stats, {'score': '123', 'skin': self.crash}, self.catalog)
        self.assertEqual(stats['bonus_points'], 123)
        self.assertEqual(stats['points_by_club']['Aku Aku'], 123)


if __name__ == '__main__':
    unittest.main()
