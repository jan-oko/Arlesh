use super::*;

#[test]
fn the_desktop_client_is_named_desktop() {
    let desktop = ClientId::desktop();
    assert_eq!(desktop.as_str(), "desktop");
    assert!(desktop.is_desktop());
    assert_eq!(desktop.to_string(), "desktop");
}

#[test]
fn a_name_of_letters_digits_dots_underscores_and_dashes_is_a_client() {
    let client: ClientId = "notebook_2.0-x".parse().unwrap();
    assert_eq!(client.as_str(), "notebook_2.0-x");
    assert!(!client.is_desktop());
}

#[test]
fn an_empty_name_is_refused() {
    assert_eq!("".parse::<ClientId>(), Err(InvalidClientId::Empty));
}

#[test]
fn a_name_longer_than_sixty_four_characters_is_refused() {
    let long = "a".repeat(MAX_CLIENT_LENGTH + 1);
    assert_eq!(
        long.parse::<ClientId>(),
        Err(InvalidClientId::TooLong(long.clone()))
    );
    assert!("a".repeat(MAX_CLIENT_LENGTH).parse::<ClientId>().is_ok());
}

#[test]
fn a_name_with_a_space_or_a_slash_is_refused() {
    for name in ["my script", "a/b", "é"] {
        assert_eq!(
            name.parse::<ClientId>(),
            Err(InvalidClientId::Character(name.to_string())),
            "{name}"
        );
    }
}
