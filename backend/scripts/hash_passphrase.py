import getpass

from argon2 import PasswordHasher

if __name__ == "__main__":
    first = getpass.getpass("Passphrase: ")
    second = getpass.getpass("Confirm passphrase: ")
    if not first or first != second:
        raise SystemExit("Passphrases are empty or do not match")
    print(PasswordHasher().hash(first))
