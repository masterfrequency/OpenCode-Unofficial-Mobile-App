#!/usr/bin/env sh
set -eu

gateway_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
config_dir="${XDG_CONFIG_HOME:-$HOME/.config}/opencode-unofficial"
service_dir="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
env_file="$config_dir/gateway.env"
service_file="$service_dir/opencode-unofficial-gateway.service"

mkdir -p "$config_dir" "$service_dir"
if [ ! -f "$env_file" ]; then
  if command -v openssl >/dev/null 2>&1; then token=$(openssl rand -hex 32)
  else token=$(node -e "process.stdout.write(require('node:crypto').randomBytes(32).toString('hex'))")
  fi
  printf 'OPENCODE_REMOTE_TOKEN=%s\n' "$token" > "$env_file"
  chmod 600 "$env_file"
fi

cat > "$service_file" <<EOF
[Unit]
Description=OpenCode Unofficial authenticated gateway
After=network-online.target

[Service]
Type=simple
WorkingDirectory=$gateway_dir
EnvironmentFile=$env_file
ExecStart=$gateway_dir/start.sh
Restart=on-failure
RestartSec=3

[Install]
WantedBy=default.target
EOF

systemctl --user daemon-reload
systemctl --user enable --now opencode-unofficial-gateway.service
printf '\nInstalled and started. Read the one-time pairing code with:\n'
printf 'cat %s/.pairing-code\n' "$gateway_dir"
printf '\nStatus: systemctl --user status opencode-unofficial-gateway\n'
