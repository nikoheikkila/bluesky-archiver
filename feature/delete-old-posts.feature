Feature: Daily deletion of posts older than one year
  The account owner's posts older than one year, with their reply and quote settings, are
  permanently deleted every day.

  Scenario: Daily run deletes only posts older than one year, with their reply and quote settings
    Given the account has these posts, each with reply settings and quote settings created with it:
      | post                             | created before the run |
      | a post about elections           | 2 years                |
      | a reply to a deleted post        | 400 days               |
      | a quote of a post about football | 365 days and 1 hour    |
      | a post about cooking             | 364 days and 23 hours  |
      | a reply about music              | 1 day                  |
    When the daily run completes
    Then the account has only the posts "a post about cooking" and "a reply about music"
    And the account has only the reply settings and quote settings of those two posts
    And the run reports that it deleted "3" of "3" posts older than one year
