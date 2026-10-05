#!/usr/bin/env bash
# Generate a self-signed code-signing certificate for Cria macOS builds.
#
# Why: ad-hoc signed builds get a new identity every build, so macOS re-asks
# for keychain access after each update. A stable certificate keeps the
# "Always Allow" grant valid.
#
# Privacy: the certificate subject is the generic name below. No name, email
# or machine details go into it, so nothing in the published app identifies you.
# The private key never leaves your machine except via the GitHub secret you
# paste it into.
#
# Usage: scripts/make-signing-cert.sh   (macOS; needs openssl)
set -euo pipefail

CN="Cria Self-Signed"
DIR="$(mktemp -d)"
trap 'rm -rf "$DIR"' EXIT
PASS="$(openssl rand -base64 18)"

cat > "$DIR/cert.cnf" <<CNF
[req]
distinguished_name = dn
x509_extensions = ext
prompt = no
[dn]
CN = $CN
[ext]
basicConstraints = critical,CA:false
keyUsage = critical,digitalSignature
extendedKeyUsage = critical,codeSigning
CNF

openssl req -x509 -newkey rsa:2048 -nodes -days 3650 \
  -keyout "$DIR/key.pem" -out "$DIR/cert.pem" -config "$DIR/cert.cnf" 2>/dev/null
# -legacy: macOS `security import` rejects OpenSSL 3's default PKCS12 encryption.
openssl pkcs12 -export -legacy -inkey "$DIR/key.pem" -in "$DIR/cert.pem" \
  -name "$CN" -out "$DIR/cria.p12" -passout "pass:$PASS" 2>/dev/null \
  || openssl pkcs12 -export -inkey "$DIR/key.pem" -in "$DIR/cert.pem" \
       -name "$CN" -out "$DIR/cria.p12" -passout "pass:$PASS"

HASH="$(openssl x509 -in "$DIR/cert.pem" -noout -fingerprint -sha1 | cut -d= -f2 | tr -d :)"

echo "Add these three GitHub repo secrets (Settings > Secrets and variables > Actions):"
echo
echo "APPLE_CERTIFICATE_PASSWORD = $PASS"
echo "APPLE_SIGNING_IDENTITY     = $HASH"
echo "APPLE_CERTIFICATE          = (base64 below, copied to clipboard if pbcopy exists)"
echo
base64 < "$DIR/cria.p12" | tr -d '\n' > "$DIR/b64.txt"
if command -v pbcopy >/dev/null; then pbcopy < "$DIR/b64.txt"; fi
cat "$DIR/b64.txt"; echo
echo
echo "Keep nothing else: the temp files are deleted on exit. To rotate, re-run and replace the secrets"
echo "(users will see one more keychain prompt after a rotation)."
