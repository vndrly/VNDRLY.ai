#!/usr/bin/env bash
# VNDRLY self-hosted coturn. No external communications provider is configured.
# Reference: https://github.com/coturn/coturn/blob/master/examples/etc/turnserver.conf
set -euo pipefail
valid_host() {
  local host=${1:-} label
  local -a labels
  [[ ${#host} -le 253 && "$host" =~ ^[a-zA-Z0-9]([a-zA-Z0-9.-]*[a-zA-Z0-9])?$ && "$host" != *..* ]] || return 1
  IFS=. read -ra labels <<< "$host"
  for label in "${labels[@]}"; do [[ ${#label} -le 63 && "$label" != -* && "$label" != *- ]] || return 1; done
}
if [[ ${1:-} == --check-host ]]; then valid_host "${2:-}"; exit $?; fi
relay_host=${1:?Pass the existing VPS host}
valid_host "$relay_host" || { echo 'Invalid relay host' >&2; exit 1; }
[[ $EUID -eq 0 ]] || { echo 'Provisioning requires root' >&2; exit 1; }
app_dir=/var/www/vndrly
env_file=$app_dir/.env.production
marker='# VNDRLY-MANAGED-AUDIO-RELAY-v2'
config_dir=/etc/vndrly-audio-relay
config=$config_dir/turnserver.conf
unit=/etc/systemd/system/vndrly-audio-relay.service
firewall=$config_dir/firewall.sh
firewall_unit=/etc/systemd/system/vndrly-audio-firewall.service
for tool in ss ip systemctl flock openssl getent awk install; do command -v "$tool" >/dev/null || { echo "Missing prerequisite: $tool" >&2; exit 1; }; done
[[ -f "$env_file" && ! -L "$env_file" ]] || { echo 'A regular production environment file is required' >&2; exit 1; }
exec 9>/run/vndrly-audio-provision.lock
flock -n 9 || { echo 'Another audio provisioning run is active' >&2; exit 1; }
umask 077
read_setting() {
  local key=$1 value count
  count=$(grep -c "^${key}=" "$env_file" || true)
  [[ $count -le 1 ]] || { echo "Duplicate environment setting: $key" >&2; return 1; }
  value=$(sed -n "s/^${key}=//p" "$env_file")
  value=${value%$'\r'}
  if [[ "$value" == \"*\" || "$value" == \'*\' ]]; then value=${value:1:${#value}-2}; fi
  printf '%s' "$value"
}
write_setting() {
  local key=$1 value=$2 temporary
  temporary=$(mktemp "$app_dir/.env.audio.XXXXXX")
  AUDIO_VALUE="$value" awk -v key="$key" 'BEGIN { seen=0 } index($0,key "=")==1 { print key "=" ENVIRON["AUDIO_VALUE"]; seen=1; next } { print } END { if(!seen) print key "=" ENVIRON["AUDIO_VALUE"] }' "$env_file" > "$temporary"
  chown --reference="$env_file" "$temporary"
  chmod --reference="$env_file" "$temporary"
  mv -T "$temporary" "$env_file"
}
[[ ! -L "$config_dir" ]] || { echo "Refusing a symlinked relay configuration directory" >&2; exit 1; }
if [[ -d "$config_dir" && ! -f "$config" && -n $(find "$config_dir" -mindepth 1 -maxdepth 1 -print -quit) ]]; then echo "Preserving unrelated relay directory contents" >&2; exit 1; fi
for owned in "$config" "$unit" "$firewall" "$firewall_unit"; do
  if [[ -e "$owned" || -L "$owned" ]]; then
    [[ -f "$owned" && ! -L "$owned" ]] && grep -Fxq "$marker" "$owned" || { echo "Refusing to overwrite unrelated configuration: $owned" >&2; exit 1; }
  fi
done
for service in vndrly-audio-relay vndrly-audio-firewall; do
  fragment=$(systemctl show "$service.service" -p FragmentPath --value 2>/dev/null || true)
  [[ -z "$fragment" || "$fragment" == "/etc/systemd/system/$service.service" ]] || { echo "Service name already belongs to another installation: $service" >&2; exit 1; }
  [[ -z $(systemctl show "$service.service" -p DropInPaths --value 2>/dev/null || true) ]] || { echo "Preserving existing service overrides for $service; review required" >&2; exit 1; }
done
urls=$(read_setting WORK_HUB_TURN_URLS)
secret=$(read_setting WORK_HUB_TURN_SECRET)
if [[ -n "$urls" ]]; then
  [[ -n "$secret" ]] || { echo 'Existing relay has no authentication secret' >&2; exit 1; }
  if [[ -f "$config" && -f "$unit" ]]; then
    configured_secret=$(sed -n 's/^static-auth-secret=//p' "$config")
    [[ "$configured_secret" == "$secret" ]] || { echo 'Existing relay and application secrets differ; neither was changed' >&2; exit 1; }
    systemctl start vndrly-audio-relay
    systemctl is-active --quiet vndrly-audio-relay
  fi
  echo 'Existing audio relay settings preserved; external connectivity still requires verification'
  exit 0
fi
public_ip=$(getent ahostsv4 "$relay_host" | awk 'NR==1 {address=$1} END {print address}')
[[ "$public_ip" =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}$ ]] || { echo 'Relay host must resolve to IPv4' >&2; exit 1; }
case "$public_ip" in 0.*|10.*|127.*|169.254.*|192.168.*|172.1[6-9].*|172.2[0-9].*|172.3[01].*) echo 'Relay host must resolve to a public address' >&2; exit 1;; esac
local_ip=$(ip -4 route get "$public_ip" | awk '{for(i=1;i<=NF;i++)if($i=="src"){print $(i+1);exit}}')
[[ "$local_ip" =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}$ ]] || { echo 'Cannot determine local relay interface' >&2; exit 1; }
if ! systemctl is-active --quiet vndrly-audio-relay; then
  if ss -H -lntu | awk '{n=split($5,a,":"); p=a[n]+0; if(p==3478 || (p>=49160 && p<=49999)) found=1} END {exit !found}'; then
    echo 'Audio listener or relay ports are already in use; existing services were not changed' >&2; exit 1
  fi
fi
if ! command -v turnserver >/dev/null; then
  [[ ! -f /lib/systemd/system/coturn.service && ! -f /etc/systemd/system/coturn.service ]] || { echo 'Existing coturn installation needs repair; refusing replacement' >&2; exit 1; }
  apt-get update -qq
  DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends coturn iptables
  # Only the default unit newly installed by this invocation is disabled.
  systemctl disable --now coturn
elif ! command -v iptables >/dev/null; then
  apt-get update -qq
  DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends iptables
fi
turn_binary=$(command -v turnserver)
[[ "$turn_binary" == /usr/bin/turnserver || "$turn_binary" == /usr/sbin/turnserver ]] || { echo 'Unexpected coturn executable; preserving custom installation' >&2; exit 1; }
if ! getent passwd vndrly-turn >/dev/null; then useradd --system --no-create-home --home-dir /nonexistent --shell /usr/sbin/nologin vndrly-turn; fi
if [[ -f "$config" ]]; then
  configured_secret=$(sed -n 's/^static-auth-secret=//p' "$config")
  [[ -z "$secret" || "$secret" == "$configured_secret" ]] || { echo 'Existing authentication secrets differ; refusing rotation' >&2; exit 1; }
  [[ -n "$configured_secret" ]] || { echo "Existing relay configuration has no secret; preserving it for review" >&2; exit 1; }
  secret=$configured_secret
fi
if [[ -z "$secret" ]]; then secret=$(openssl rand -hex 32); fi
# Reject ambiguous/multiline configuration without changing an existing secret.
[[ "$secret" =~ ^[a-zA-Z0-9_+/=.~-]{32,256}$ ]] || { echo 'Existing relay secret cannot be represented safely; it was preserved' >&2; exit 1; }
write_setting WORK_HUB_TURN_SECRET "$secret"
install -d -m 750 -o root -g vndrly-turn "$config_dir"
if [[ ! -f "$config" ]]; then
  cat > "$config" <<EOF
$marker
listening-port=3478
listening-ip=$local_ip
relay-ip=$local_ip
external-ip=$public_ip/$local_ip
fingerprint
use-auth-secret
static-auth-secret=$secret
realm=vndrly.ai
server-name=vndrly.ai
min-port=49160
max-port=49999
user-quota=16
total-quota=400
max-bps=256000
bps-capacity=10000000
stale-nonce=600
pidfile=/run/vndrly-audio-relay/turnserver.pid
userdb=/run/vndrly-audio-relay/turndb
no-cli
no-tls
no-dtls
no-multicast-peers
no-tcp-relay
no-software-attribute
denied-peer-ip=0.0.0.0-0.255.255.255
denied-peer-ip=10.0.0.0-10.255.255.255
denied-peer-ip=100.64.0.0-100.127.255.255
denied-peer-ip=127.0.0.0-127.255.255.255
denied-peer-ip=169.254.0.0-169.254.255.255
denied-peer-ip=172.16.0.0-172.31.255.255
denied-peer-ip=192.0.0.0-192.0.0.255
denied-peer-ip=192.168.0.0-192.168.255.255
denied-peer-ip=198.18.0.0-198.19.255.255
denied-peer-ip=224.0.0.0-255.255.255.255
denied-peer-ip=::-ffff:ffff:ffff:ffff:ffff:ffff:ffff:ffff
syslog
EOF
  chown root:vndrly-turn "$config"; chmod 640 "$config"
fi
if [[ ! -f "$firewall" ]]; then
  local_addresses=$(ip -o -4 address show | awk '{split($4,a,"/"); print a[1]}' | sort -u | tr '\n' ' ')
  cat > "$firewall" <<EOF
#!/usr/bin/env bash
$marker
set -euo pipefail
# Permit TURN-to-TURN traffic on this host, but prevent relay access to its other UDP services.
for address in $public_ip $local_addresses; do
  rule=(-m owner --uid-owner vndrly-turn -p udp -d "\$address" ! --dport 49160:49999 -m comment --comment vndrly-audio-self-peer -j REJECT)
  /usr/sbin/iptables -w -C OUTPUT "\${rule[@]}" 2>/dev/null || /usr/sbin/iptables -w -I OUTPUT "\${rule[@]}"
done
EOF
  chmod 700 "$firewall"
fi
if [[ ! -f "$firewall_unit" ]]; then
  cat > "$firewall_unit" <<EOF
$marker
[Unit]
Description=VNDRLY audio relay peer boundary
Before=vndrly-audio-relay.service
[Service]
Type=oneshot
ExecStart=$firewall
RemainAfterExit=yes
EOF
fi
if [[ ! -f "$unit" ]]; then
  cat > "$unit" <<EOF
$marker
[Unit]
Description=VNDRLY internal audio relay
After=network-online.target vndrly-audio-firewall.service
Wants=network-online.target
Requires=vndrly-audio-firewall.service
[Service]
User=vndrly-turn
Group=vndrly-turn
RuntimeDirectory=vndrly-audio-relay
RuntimeDirectoryMode=0750
ExecStart=$turn_binary -c $config
Restart=on-failure
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectControlGroups=true
RestrictSUIDSGID=true
CapabilityBoundingSet=
RestrictAddressFamilies=AF_INET AF_INET6 AF_UNIX
[Install]
WantedBy=multi-user.target
EOF
fi
chmod 644 "$unit" "$firewall_unit"
if command -v ufw >/dev/null && ufw status | grep -q '^Status: active'; then
  ufw allow 3478/tcp comment 'VNDRLY internal audio'
  ufw allow 3478/udp comment 'VNDRLY internal audio'
  ufw allow 49160:49999/udp comment 'VNDRLY internal audio relay'
fi
systemctl daemon-reload
systemctl enable --now vndrly-audio-relay
# Type=simple becomes active before coturn finishes opening both listeners.
# Wait for readiness before publishing URLs or allowing the API deploy onward.
relay_ready=false
for attempt in {1..30}; do
  if systemctl is-active --quiet vndrly-audio-relay &&
    [[ -n $(ss -H -ltn 'sport = :3478') ]] &&
    [[ -n $(ss -H -lun 'sport = :3478') ]]; then
    relay_ready=true
    break
  fi
  sleep 1
done
[[ "$relay_ready" == true ]] || { echo 'Relay did not open TCP and UDP listeners within 30 seconds' >&2; exit 1; }
write_setting WORK_HUB_TURN_URLS "turn:$relay_host:3478?transport=udp,turn:$relay_host:3478?transport=tcp"
unset secret configured_secret
echo 'Self-hosted relay is listening; verify external allocation and provider firewall before claiming NAT connectivity'
