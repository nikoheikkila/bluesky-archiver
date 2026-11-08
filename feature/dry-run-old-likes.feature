Feature: Dry run listing likes older than one year
  The account owner sees which likes are older than one year before any of them is deleted.

  Scenario: Dry run lists only likes older than one year
    Given the account has these likes:
      | liked post              | created before the run |
      | a post about elections  | 2 years                |
      | a post that was deleted | 400 days               |
      | a post about football   | 365 days and 1 hour    |
      | a post about cooking    | 364 days and 23 hours  |
      | a post about music      | 1 day                  |
    When the dry run completes
    Then the dry run lists the likes of "a post about elections", "a post that was deleted" and "a post about football"
    And the dry run reports that "3" likes are older than one year and would be deleted
    And the account still has all "5" likes
