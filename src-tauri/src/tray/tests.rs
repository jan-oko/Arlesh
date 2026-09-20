use super::*;

#[test]
fn closing_with_the_preference_on_hides_to_the_tray() {
    assert_eq!(close_action(true, false), CloseAction::HideToTray);
}

#[test]
fn closing_with_the_preference_off_quits() {
    assert_eq!(close_action(false, false), CloseAction::Quit);
}

#[test]
fn a_requested_quit_closes_even_with_the_preference_on() {
    assert_eq!(close_action(true, true), CloseAction::Quit);
}

#[test]
fn a_requested_quit_closes_with_the_preference_off_too() {
    assert_eq!(close_action(false, true), CloseAction::Quit);
}

#[test]
fn a_fresh_preference_closes_to_the_tray() {
    let preference = ClosePreference::default();

    assert!(preference.close_to_tray());
    assert!(!preference.quit_requested());
    assert_eq!(preference.action(), CloseAction::HideToTray);
}

#[test]
fn turning_the_preference_off_makes_closing_quit() {
    let preference = ClosePreference::new();

    preference.set_close_to_tray(false);

    assert!(!preference.close_to_tray());
    assert_eq!(preference.action(), CloseAction::Quit);
}

#[test]
fn turning_the_preference_back_on_restores_hiding() {
    let preference = ClosePreference::new();

    preference.set_close_to_tray(false);
    preference.set_close_to_tray(true);

    assert_eq!(preference.action(), CloseAction::HideToTray);
}

#[test]
fn requesting_a_quit_overrides_the_preference() {
    let preference = ClosePreference::new();

    preference.request_quit();

    assert!(preference.quit_requested());
    assert_eq!(preference.action(), CloseAction::Quit);
}

#[test]
fn a_requested_quit_is_not_undone_by_setting_the_preference() {
    let preference = ClosePreference::new();

    preference.request_quit();
    preference.set_close_to_tray(true);

    assert_eq!(preference.action(), CloseAction::Quit);
}
