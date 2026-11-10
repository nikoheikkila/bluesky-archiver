Feature: Keep the pinned post
  The account owner's pinned post is never deleted by the daily run, however old it is.

  Scenario: Daily run keeps the pinned post when every other post is deleted
    Given the account has these posts:
      | post                   | created before the run |
      | a post about elections | 2 years                |
      | a welcome post         | 400 days               |
      | a reply about music    | 365 days and 1 hour    |
    And the post "a welcome post" is pinned
    When the daily run completes
    Then the account has only the post "a welcome post"
    And the run reports that it deleted "2" of "2" posts older than one year
