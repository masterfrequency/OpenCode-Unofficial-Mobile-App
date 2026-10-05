#!/bin/sh
set -eu
project_dir=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
build_dir="$project_dir/packaging/debian/build"
export TMPDIR="$build_dir/tmp"
package_dir="$build_dir/opencode-unofficial-gateway_1.1.0_all"
mkdir -p "$TMPDIR" "$package_dir/DEBIAN" "$package_dir/usr/lib/opencode-unofficial-gateway" "$package_dir/usr/bin"
cp -R "$project_dir/gateway/." "$package_dir/usr/lib/opencode-unofficial-gateway/"
cp "$project_dir/packaging/debian/opencode-unofficial-setup" "$package_dir/usr/bin/opencode-unofficial-setup"
chmod 755 "$package_dir/usr/bin/opencode-unofficial-setup"
cat > "$package_dir/DEBIAN/control" <<'EOF'
Package: opencode-unofficial-gateway
Version: 1.1.0
Section: devel
Priority: optional
Architecture: all
Depends: nodejs (>= 20)
Maintainer: PhonkAlphabet
Description: Companion gateway for OpenCode Unofficial Android client
 Installs the gateway payload and an interactive per-user setup command.
EOF
dpkg-deb --root-owner-group --build "$package_dir" "$project_dir/app/src/main/assets/opencode-unofficial-gateway.deb"
