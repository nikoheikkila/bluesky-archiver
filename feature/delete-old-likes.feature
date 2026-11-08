Feature: Daily deletion of likes older than one year
  The account owner's likes older than one year are permanently deleted every day.

  Scenario: Daily run deletes only likes older than one year
    Given the account has these likes:
      | liked post              | created before the run |
      | a post about elections  | 2 years                |
      | a post that was deleted | 400 days               |
      | a post about football   | 365 days and 1 hour    |
      | a post about cooking    | 364 days and 23 hours  |
      | a post about music      | 1 day                  |
    When the daily run completes
    Then the account has only the likes of "a post about cooking" and "a post about music"
    And the run reports that it deleted "3" of "3" likes older than one year
