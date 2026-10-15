//! Verifies the macOS Keychain round-trip that the webview cannot test.
//!
//! Plan §13 lists "keys lost on restart" as a risk, and §5.1 warns about
//! keyring silently falling back to a mock store. Both would leave this failing.

use keyring::Entry;

const SERVICE: &str = "app.geist.test";

fn cleanup(account: &str) {
    let _ = Entry::new(SERVICE, account).and_then(|e| e.delete_credential());
}

#[test]
fn keychain_round_trips_a_secret() {
    let account = "https://example.invalid";
    cleanup(account);

    let entry = Entry::new(SERVICE, account).expect("open keychain entry");
    entry
        .set_password("id:deadbeef")
        .expect("write to the macOS keychain");

    let read = Entry::new(SERVICE, account)
        .expect("reopen keychain entry")
        .get_password()
        .expect("read back from the macOS keychain");
    assert_eq!(read, "id:deadbeef");

    Entry::new(SERVICE, account)
        .expect("entry for delete")
        .delete_credential()
        .expect("delete credential");
}

#[test]
fn missing_entry_is_reported_as_no_entry() {
    let account = "https://never-stored.invalid";
    cleanup(account);

    match Entry::new(SERVICE, account).unwrap().get_password() {
        Err(keyring::Error::NoEntry) => {}
        other => panic!("expected NoEntry, got {other:?}"),
    }
}

#[test]
fn a_second_write_updates_in_place() {
    let account = "https://update.invalid";
    cleanup(account);

    let entry = Entry::new(SERVICE, account).unwrap();
    entry.set_password("first").unwrap();
    entry.set_password("second").unwrap();

    let read = Entry::new(SERVICE, account)
        .unwrap()
        .get_password()
        .unwrap();
    assert_eq!(read, "second");

    cleanup(account);
}

#[test]
fn store_status_is_available() {
    // Guards against keyring falling back to an in-memory mock store, which is
    // the failure mode that made keys vanish on restart.
    assert!(
        keyring::Entry::store_status().is_ok(),
        "no usable credential store: {:?}",
        keyring::Entry::store_status()
    );
}
