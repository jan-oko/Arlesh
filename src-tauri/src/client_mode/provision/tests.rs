use super::*;

fn scratch(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("arlesh-provision-{name}-{}", std::process::id()));
    std::fs::remove_dir_all(&dir).ok();
    std::fs::create_dir_all(&dir).expect("a scratch directory");
    dir
}

#[test]
fn a_good_provision_parses_and_loses_the_trailing_slash() {
    let got = parse(r#"{"url": "http://100.64.0.2:14701/", "token": " abc "}"#).expect("parsed");

    assert_eq!(got.url, "http://100.64.0.2:14701");
    assert_eq!(got.token, "abc");
}

#[test]
fn a_non_http_url_is_refused() {
    for url in ["ftp://box", "box:14701", "", "http://", "http:///x", "http://a b"] {
        let text = format!(r#"{{"url": "{url}", "token": "t"}}"#);
        assert_eq!(parse(&text), Err(ProvisionError::BadUrl), "{url}");
    }
}

#[test]
fn an_empty_token_is_refused() {
    assert_eq!(
        parse(r#"{"url": "http://box:1", "token": "  "}"#),
        Err(ProvisionError::EmptyToken)
    );
}

#[test]
fn something_that_is_not_the_object_is_refused() {
    assert!(matches!(parse("nope"), Err(ProvisionError::Malformed(_))));
    assert!(matches!(
        parse(r#"{"url": "http://box:1"}"#),
        Err(ProvisionError::Malformed(_))
    ));
}

#[test]
fn applying_stores_the_token_saves_client_mode_and_deletes_the_file() {
    let dir = scratch("apply");
    std::fs::write(
        dir.join(PROVISION_FILE),
        r#"{"url": "http://box:1", "token": "secret"}"#,
    )
    .expect("written");

    apply(&dir);

    assert_eq!(
        settings::read(&dir),
        Some(Mode::Client {
            url: "http://box:1".to_owned(),
            token_in_file: true
        })
    );
    assert_eq!(
        vault::load(&dir, "http://box:1", true).expect("read"),
        Some("secret".to_owned())
    );
    assert!(!dir.join(PROVISION_FILE).exists());
    std::fs::remove_dir_all(&dir).ok();
}

#[test]
fn a_bad_provision_changes_nothing_and_is_deleted() {
    let dir = scratch("bad");
    std::fs::write(dir.join(PROVISION_FILE), r#"{"url": "x", "token": "t"}"#).expect("written");

    apply(&dir);

    assert_eq!(settings::read(&dir), None);
    assert!(!dir.join(PROVISION_FILE).exists());
    std::fs::remove_dir_all(&dir).ok();
}

#[test]
fn no_file_changes_nothing() {
    let dir = scratch("none");

    apply(&dir);

    assert_eq!(settings::read(&dir), None);
    std::fs::remove_dir_all(&dir).ok();
}
