use super::*;

#[test]
fn a_token_is_sixty_four_hex_digits_and_never_repeats() {
    let first = random_token().unwrap();
    let second = random_token().unwrap();

    assert_eq!(first.len(), 64);
    assert!(first.chars().all(|c| c.is_ascii_hexdigit()));
    assert_ne!(first, second);
}

#[test]
fn a_pin_has_eight_digits() {
    let pin = random_pin().unwrap();

    assert_eq!(pin.len(), pins::LENGTH);
    assert!(pin.chars().all(|c| c.is_ascii_digit()));
}

#[test]
fn the_digest_of_abc_is_the_known_sha256() {
    assert_eq!(
        digest("abc"),
        "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
    );
}
