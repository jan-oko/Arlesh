use super::*;

/// The close of the one window that is left — the only close the preference is about.
const LAST: bool = true;
/// The close of a window with others still open.
const NOT_LAST: bool = false;

#[test]
fn closing_the_last_window_with_the_preference_on_hides_it_to_the_tray() {
    assert_eq!(close_action(true, false, LAST), CloseAction::HideToTray);
}

#[test]
fn closing_the_last_window_with_the_preference_off_quits() {
    assert_eq!(close_action(false, false, LAST), CloseAction::Close);
}

#[test]
fn closing_one_of_several_windows_just_closes_it() {
    assert_eq!(close_action(true, false, NOT_LAST), CloseAction::Close);
}

#[test]
fn closing_one_of_several_windows_with_the_preference_off_also_just_closes_it() {
    assert_eq!(close_action(false, false, NOT_LAST), CloseAction::Close);
}

#[test]
fn a_requested_quit_closes_even_with_the_preference_on() {
    assert_eq!(close_action(true, true, LAST), CloseAction::Close);
}

#[test]
fn a_requested_quit_closes_with_the_preference_off_too() {
    assert_eq!(close_action(false, true, LAST), CloseAction::Close);
}

#[test]
fn a_requested_quit_closes_every_window_it_reaches() {
    assert_eq!(close_action(true, true, NOT_LAST), CloseAction::Close);
}

/// A preference with a tray up, which is what every `action` test below is about.
fn with_tray() -> ClosePreference {
    let preference = ClosePreference::new();
    preference.mark_tray_available();
    preference
}

#[test]
fn a_fresh_preference_hides_the_last_window_to_the_tray() {
    let preference = with_tray();

    assert!(preference.close_to_tray());
    assert!(!preference.quit_requested());
    assert_eq!(preference.action(LAST), CloseAction::HideToTray);
    assert_eq!(preference.action(NOT_LAST), CloseAction::Close);
}

#[test]
fn a_preference_with_no_tray_lets_the_last_window_close() {
    let preference = ClosePreference::default();

    assert!(preference.close_to_tray());
    assert!(!preference.tray_available());
    assert_eq!(preference.action(LAST), CloseAction::Close);
}

#[test]
fn a_tray_that_goes_up_makes_the_preference_take_effect() {
    let preference = ClosePreference::new();

    assert_eq!(preference.action(LAST), CloseAction::Close);
    preference.mark_tray_available();
    assert_eq!(preference.action(LAST), CloseAction::HideToTray);
}

#[test]
fn turning_the_preference_off_makes_closing_quit() {
    let preference = with_tray();

    preference.set_close_to_tray(false);

    assert!(!preference.close_to_tray());
    assert_eq!(preference.action(LAST), CloseAction::Close);
}

#[test]
fn turning_the_preference_back_on_restores_hiding() {
    let preference = with_tray();

    preference.set_close_to_tray(false);
    preference.set_close_to_tray(true);

    assert_eq!(preference.action(LAST), CloseAction::HideToTray);
}

#[test]
fn requesting_a_quit_overrides_the_preference() {
    let preference = with_tray();

    preference.request_quit();

    assert!(preference.quit_requested());
    assert_eq!(preference.action(LAST), CloseAction::Close);
}

#[test]
fn a_requested_quit_is_not_undone_by_setting_the_preference() {
    let preference = with_tray();

    preference.request_quit();
    preference.set_close_to_tray(true);

    assert_eq!(preference.action(LAST), CloseAction::Close);
}

#[test]
fn clicking_the_tray_with_a_window_showing_hides_it() {
    assert_eq!(activate_action(Some(true)), ActivateAction::Hide);
}

#[test]
fn clicking_the_tray_with_every_window_hidden_shows_them() {
    assert_eq!(activate_action(Some(false)), ActivateAction::Show);
}

#[test]
fn clicking_the_tray_when_visibility_is_unreadable_shows_the_windows() {
    assert_eq!(activate_action(None), ActivateAction::Show);
}
