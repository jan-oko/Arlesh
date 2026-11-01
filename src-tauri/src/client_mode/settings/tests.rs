use super::*;

#[test]
fn a_device_with_no_setting_and_no_board_is_asked() {
    assert_eq!(
        startup(None, false, true),
        Startup {
            mode: Mode::Standalone,
            first_run: true
        }
    );
}

#[test]
fn an_install_from_before_client_mode_stays_standalone_unasked() {
    assert!(!startup(None, true, true).first_run);
}

#[test]
fn a_saved_mode_is_the_mode() {
    let client = Mode::Client {
        url: "https://box:4750".to_owned(),
        token_in_file: false,
    };

    assert_eq!(startup(Some(client.clone()), true, true).mode, client);
}

#[test]
fn the_setting_reads_back_as_it_was_written() {
    let dir = std::env::temp_dir().join(format!("arlesh-mode-{}", std::process::id()));
    std::fs::create_dir_all(&dir).expect("a scratch directory");
    let client = Mode::Client {
        url: "http://127.0.0.1:4750".to_owned(),
        token_in_file: true,
    };

    write(&dir, &client).expect("written");

    assert_eq!(read(&dir), Some(client));
    std::fs::remove_dir_all(&dir).ok();
}

#[test]
fn a_missing_or_broken_setting_reads_as_none() {
    let dir = std::env::temp_dir().join(format!("arlesh-mode-broken-{}", std::process::id()));
    std::fs::create_dir_all(&dir).expect("a scratch directory");

    assert_eq!(read(&dir), None);
    std::fs::write(dir.join(MODE_FILE), "not json").expect("written");
    assert_eq!(read(&dir), None);
    std::fs::remove_dir_all(&dir).ok();
}

#[test]
fn a_build_without_standalone_asks_which_server_and_runs_as_a_client_of_none() {
    for saved in [None, Some(Mode::Standalone)] {
        let started = startup(saved, false, false);

        assert!(started.first_run);
        assert_eq!(
            started.mode,
            Mode::Client {
                url: String::new(),
                token_in_file: false
            }
        );
    }
}

#[test]
fn a_build_without_standalone_keeps_a_saved_server() {
    let client = Mode::Client {
        url: "https://box".to_owned(),
        token_in_file: false,
    };

    let started = startup(Some(client.clone()), false, false);

    assert_eq!(started.mode, client);
    assert!(!started.first_run);
}
