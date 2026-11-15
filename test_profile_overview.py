import unittest

from time_trial_gui import profile_character_totals


class ProfileCharacterTotalsTests(unittest.TestCase):
    def test_multiple_skins_share_character_and_use_bonus_score(self):
        characters = [{"character_id": "14", "character": "Fake Crash"},
                      {"character_id": "1", "character": "Crash"}]
        skins = [{"skin": "fake-a", "character_id": "14"},
                 {"skin": "fake-b", "character_id": "14"}]
        trials = [{"skin": "fake-a"}, {"skin": "fake-b"}, {"skin": "unknown"}]
        rallies = [{"skin": "fake-a", "score": "100", "score_mult": "125", "laps": "3"},
                   {"skin": "fake-b", "score": "200", "score_mult": "", "laps": "4"}]

        totals = {row["character_id"]: row for row in profile_character_totals(characters, skins, trials, rallies)}
        self.assertEqual((totals["14"]["trial_runs"], totals["14"]["rally_runs"]), (2, 2))
        self.assertEqual((totals["14"]["score"], totals["14"]["laps"]), (325, 7))
        self.assertEqual(totals["1"]["trial_runs"], 0)

    def test_track_breakdown_aggregates_skins_and_modes(self):
        characters = [{"character_id": "14", "character": "Fake Crash"}]
        skins = [{"skin": "a", "character_id": "14"}, {"skin": "b", "character_id": "14"}]
        tracks = [{"track": "track-a", "track_clean": "Track A"}, {"track": "track-b", "track_clean": "Track B"}]
        trials = [{"skin": "a", "track": "track-a"}, {"skin": "b", "track": "track-a"}]
        rallies = [{"skin": "b", "track": "track-a", "score": "10", "score_mult": "15", "laps": "2"},
                   {"skin": "a", "track": "track-b", "score": "20", "score_mult": "25", "laps": "3"}]
        character = profile_character_totals(characters, skins, trials, rallies, tracks)[0]
        by_track = {track["track_clean"]: track for track in character["tracks"]}
        self.assertEqual((by_track["Track A"]["trial_runs"], by_track["Track A"]["rally_runs"], by_track["Track A"]["score"], by_track["Track A"]["laps"]), (2, 1, 15, 2))
        self.assertEqual((by_track["Track B"]["trial_runs"], by_track["Track B"]["score"]), (0, 25))


if __name__ == "__main__":
    unittest.main()
