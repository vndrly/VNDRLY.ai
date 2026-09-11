#!/usr/bin/env bash
# Downloads public code/model assets only. Meeting audio never leaves this VPS.
set -euo pipefail

speech_fail() { printf 'Native speech: %s\n' "$*" >&2; return 1; }
speech_check_headroom() {
  local memory=${1:-} disk=${2:-} cores=${3:-} load=${4:-}
  [[ $memory =~ ^[0-9]+$ && $disk =~ ^[0-9]+$ && $cores =~ ^[0-9]+$ && $load =~ ^[0-9]+([.][0-9]+)?$ ]] || { speech_fail 'Invalid resource headroom measurements'; return 1; }
  # Installation admission only; the concurrent benchmark decides actual serving capacity.
  awk -v memory="$memory" -v disk="$disk" -v cores="$cores" -v load_avg="$load" \
    'BEGIN {exit !(memory>=1048576 && disk>=2097152 && cores>=1 && load_avg<=cores/2)}' || {
    speech_fail "Insufficient headroom: available_memory_kib=$memory disk_kib=$disk cores=$cores load1=$load (need 1024 MiB, 2 GiB, 1 core, load <= half the cores)"; return 1;
  }
}
speech_check_smoke() {
  local transcript=${1:-} metrics=${2:-} memory=${3:-} elapsed rss extra
  [[ -f $transcript && -f $metrics && $memory =~ ^[0-9]+$ ]] || { speech_fail 'Missing smoke-test evidence'; return 1; }
  read -r elapsed rss extra < "$metrics"
  [[ $elapsed =~ ^[0-9]+([.][0-9]+)?$ && $rss =~ ^[0-9]+$ && -z $extra ]] || { speech_fail 'Invalid smoke-test measurements'; return 1; }
  grep -Eiq 'ask not what your country can do for you' "$transcript" || { speech_fail 'The public sample was not transcribed correctly'; return 1; }
  # Pinned jfk.wav is 11 seconds. Each concurrent worker needs 20% timing headroom.
  awk -v elapsed="$elapsed" -v rss="$rss" -v memory="$memory" \
    'BEGIN {exit !(elapsed>0 && elapsed<=8.8 && rss>0 && 2*rss+524288<=memory)}' || {
    speech_fail "Smoke-test headroom failed: elapsed_seconds=$elapsed max_rss_kib=$rss available_memory_kib=$memory"; return 1;
  }
}
speech_validate_environment() {
  local file=$1 binary=$2 model=$3 ffmpeg=$4 key count exact value expected
  [[ -f $file && ! -L $file ]] || { speech_fail 'A regular application environment file is required'; return 1; }
  for key in VNDRLY_NATIVE_TRANSCRIBE_ENABLED VNDRLY_WHISPER_BIN VNDRLY_WHISPER_MODEL VNDRLY_FFMPEG_BIN; do
    count=$(grep -Ec "^[[:space:]]*(export[[:space:]]+)?${key}[[:space:]]*=" "$file" || true)
    exact=$(grep -c "^${key}=" "$file" || true)
    [[ $count -le 1 && $count == "$exact" ]] || { speech_fail "Ambiguous existing environment setting: $key"; return 1; }
    value=$(sed -n "s/^${key}=//p" "$file"); value=${value%$'\r'}
    case $key in
      VNDRLY_NATIVE_TRANSCRIBE_ENABLED) [[ -z $value || $value == 0 || $value == 1 ]] || { speech_fail 'Preserving a custom transcription setting'; return 1; }; continue;;
      VNDRLY_WHISPER_BIN) expected=$binary;;
      VNDRLY_WHISPER_MODEL) expected=$model;;
      VNDRLY_FFMPEG_BIN) expected=$ffmpeg;;
    esac
    [[ -z $value || $value == "$expected" ]] || { speech_fail "Preserving an existing custom path: $key"; return 1; }
  done
}
speech_update_environment() {
  local file=$1 binary=$2 model=$3 ffmpeg=$4 enabled=${5:-1} temporary
  [[ $enabled == 0 || $enabled == 1 ]] || return 1
  speech_validate_environment "$file" "$binary" "$model" "$ffmpeg" || return 1
  temporary=$(mktemp "${file}.native.XXXXXX")
  SPEECH_BINARY=$binary SPEECH_MODEL=$model SPEECH_FFMPEG=$ffmpeg SPEECH_ENABLED=$enabled awk '
    BEGIN { values["VNDRLY_NATIVE_TRANSCRIBE_ENABLED"]=ENVIRON["SPEECH_ENABLED"]; values["VNDRLY_WHISPER_BIN"]=ENVIRON["SPEECH_BINARY"]; values["VNDRLY_WHISPER_MODEL"]=ENVIRON["SPEECH_MODEL"]; values["VNDRLY_FFMPEG_BIN"]=ENVIRON["SPEECH_FFMPEG"] }
    { key=$0; sub(/=.*/,"",key); if (key in values) {print key "=" values[key]; seen[key]=1} else print }
    END { for (key in values) if (!seen[key]) print key "=" values[key] }
  ' "$file" > "$temporary"
  chown --reference="$file" "$temporary"
  chmod --reference="$file" "$temporary"
  if cmp -s "$file" "$temporary"; then rm -f -- "$temporary"; else mv -T "$temporary" "$file"; fi
}
speech_activate_after_smoke() {
  local file=$1 binary=$2 model=$3 ffmpeg=$4 smoke=$5 available_memory=$6
  speech_check_smoke "$smoke/first.txt" "$smoke/first.metrics" "$available_memory" || return 1
  speech_check_smoke "$smoke/second.txt" "$smoke/second.metrics" "$available_memory" || return 1
  speech_update_environment "$file" "$binary" "$model" "$ffmpeg" 1
}
speech_root_directory() {
  local directory=$1
  [[ ! -L $directory ]] || { speech_fail "Refusing a symlink: $directory"; return 1; }
  if [[ -e $directory ]]; then
    [[ -d $directory && $(stat -c %u "$directory") == 0 ]] || { speech_fail "Preserving an unowned path: $directory"; return 1; }
    [[ -z $(find "$directory" -maxdepth 0 -perm /022 -print) ]] || { speech_fail "Directory is writable by other users: $directory"; return 1; }
  else install -d -m 755 -o root -g root "$directory"; fi
}
speech_verify_file() {
  local file=$1 digest=$2
  [[ -f $file && ! -L $file && $(stat -c %u "$file") == 0 ]] || { speech_fail "Invalid pinned asset: $file"; return 1; }
  [[ -z $(find "$file" -maxdepth 0 -perm /022 -print) ]] || { speech_fail "Asset is writable by other users: $file"; return 1; }
  printf '%s  %s\n' "$digest" "$file" | sha256sum -c - >/dev/null || { speech_fail "Pinned asset checksum mismatch: $file"; return 1; }
}
speech_download() {
  local url=$1 digest=$2 file=$3 temporary
  if [[ -e $file || -L $file ]]; then speech_verify_file "$file" "$digest"; return; fi
  temporary=$(mktemp "${file}.download.XXXXXX")
  curl --fail --location --proto '=https' --proto-redir '=https' --connect-timeout 20 --max-time 600 --retry 2 --output "$temporary" "$url"
  printf '%s  %s\n' "$digest" "$temporary" | sha256sum -c - >/dev/null
  chown root:root "$temporary"; chmod 444 "$temporary"
  mv -T "$temporary" "$file"
}
speech_measure_headroom() {
  speech_memory=$(awk '/^MemAvailable:/ {print $2}' /proc/meminfo)
  speech_disk=$(df -Pk /opt | awk 'NR==2 {print $4}')
  speech_cores=$(nproc)
  speech_load=$(awk '{print $1}' /proc/loadavg)
  # After compilation, loadavg includes our own finished compiler jobs. Use measured
  # inference timing for CPU admission then, while still checking memory and disk.
  if [[ ${1:-} == benchmark ]]; then speech_check_headroom "$speech_memory" "$speech_disk" "$speech_cores" 0
  else speech_check_headroom "$speech_memory" "$speech_disk" "$speech_cores" "$speech_load"; fi
}
speech_provision() {
  [[ $EUID -eq 0 ]] || { speech_fail 'Provisioning requires root'; return 1; }
  grep -Eq '^ID="?ubuntu"?$' /etc/os-release || { speech_fail 'This provisioner requires Ubuntu'; return 1; }
  local root=/opt/vndrly-speech version=whisper-v1.8.3-2eeeba56
  local commit=2eeeba56e9edd762b4b38467bab96c2517163158
  local source_sha=089b898aa83b24a8321e0fd554eeb0967fb03dd687e27f6374c72d3363b5b429
  local model_commit=5359861c739e955e79d9a303bcbc70fb988958b1
  local model_sha=60ed5bc3dd14eea856493d334349b405782ddcaf0028d4b5df4088345fba2efe
  local sample_sha=59dfb9a4acb36fe2a2affc14bacbee2920ff435cb13cc314a08c13f66ba7860e
  local env_file=/var/www/vndrly/.env.production
  local binary=$root/$version/bin/whisper-cli model=$root/models/ggml-base-60ed5bc3dd14.bin
  local archive=$root/downloads/whisper-$commit.tar.gz ffmpeg=/usr/bin/ffmpeg
  local tool stage sample smoke first_pid second_pid failed=0 memory_before report group
  for tool in awk grep sed stat find install flock getent nproc df sha256sum timeout runuser; do command -v "$tool" >/dev/null || { speech_fail "Missing prerequisite: $tool"; return 1; }; done
  getent passwd vndrly >/dev/null && [[ $(id -u vndrly) != 0 ]] || { speech_fail 'The existing non-root vndrly account is required'; return 1; }
  group=$(id -gn vndrly)
  speech_validate_environment "$env_file" "$binary" "$model" "$ffmpeg"
  exec 9>/run/vndrly-native-speech-provision.lock
  flock -n 9 || { speech_fail 'Another provisioner is active'; return 1; }
  umask 022
  # Fail closed for the next API restart. No running service is restarted here.
  speech_update_environment "$env_file" "$binary" "$model" "$ffmpeg" 0
  speech_root_directory /opt
  speech_measure_headroom
  printf 'Headroom: memory_kib=%s disk_kib=%s cores=%s load1=%s\n' "$speech_memory" "$speech_disk" "$speech_cores" "$speech_load"
  if [[ -d $root && ! -f $root/.vndrly-managed && -n $(find "$root" -mindepth 1 -maxdepth 1 -print -quit) ]]; then speech_fail 'Preserving an unrelated /opt/vndrly-speech directory'; return 1; fi
  speech_root_directory "$root"
  if [[ ! -e $root/.vndrly-managed ]]; then printf '%s\n' 'VNDRLY native speech v1' > "$root/.vndrly-managed"; chmod 444 "$root/.vndrly-managed"; fi
  speech_root_directory "$root/downloads"; speech_root_directory "$root/models"
  if ! command -v cmake >/dev/null || ! command -v g++ >/dev/null || ! command -v curl >/dev/null || [[ ! -x /usr/bin/ffmpeg || ! -x /usr/bin/time ]]; then
    apt-get update -qq
    DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends build-essential cmake curl ca-certificates ffmpeg time
  fi
  [[ -x $ffmpeg && ! -L $ffmpeg && $(stat -c %u "$ffmpeg") == 0 ]] || { speech_fail 'A root-owned Ubuntu ffmpeg executable is required'; return 1; }
  speech_download "https://codeload.github.com/ggml-org/whisper.cpp/tar.gz/$commit" "$source_sha" "$archive"
  speech_download "https://huggingface.co/ggerganov/whisper.cpp/resolve/$model_commit/ggml-base.bin" "$model_sha" "$model"
  if [[ ! -e $root/$version && ! -L $root/$version ]]; then
    stage=$(mktemp -d "$root/.build.XXXXXX")
    chmod 755 "$stage"
    tar -tzf "$archive" | awk '/^\// || /(^|\/)\.\.(\/|$)/ {bad=1} END {exit bad}' || { speech_fail 'Unexpected source archive paths'; return 1; }
    tar -xzf "$archive" --no-same-owner --no-same-permissions -C "$stage"
    timeout --kill-after=5s 900s cmake -S "$stage/whisper.cpp-$commit" -B "$stage/build" -DCMAKE_BUILD_TYPE=Release -DBUILD_SHARED_LIBS=OFF -DGGML_NATIVE=ON -DGGML_OPENMP=OFF -DWHISPER_BUILD_TESTS=OFF -DWHISPER_BUILD_EXAMPLES=ON -DWHISPER_CURL=OFF
    timeout --kill-after=5s 900s cmake --build "$stage/build" --target whisper-cli --parallel 1
    install -d -m 755 "$stage/release/bin"
    install -m 555 "$stage/build/bin/whisper-cli" "$stage/release/bin/whisper-cli"
    sample=$stage/whisper.cpp-$commit/samples/jfk.wav
    speech_verify_file "$sample" "$sample_sha"
    install -m 444 "$sample" "$stage/release/jfk.wav"
    printf '%s\n' "$commit $source_sha" > "$stage/release/SOURCE"
    (cd "$stage/release" && sha256sum bin/whisper-cli jfk.wav > SHA256SUMS)
    chmod 444 "$stage/release/SOURCE" "$stage/release/SHA256SUMS"
    mv -T "$stage/release" "$root/$version"
    printf 'Build sources retained for inspection: %s\n' "$stage"
  fi
  speech_root_directory "$root/$version"; speech_root_directory "$root/$version/bin"
  for tool in "$binary" "$root/$version/SOURCE" "$root/$version/SHA256SUMS"; do
    [[ -f $tool && ! -L $tool && $(stat -c %u "$tool") == 0 && -z $(find "$tool" -maxdepth 0 -perm /022 -print) ]] || { speech_fail "Untrusted installed asset: $tool"; return 1; }
  done
  grep -Fxq "$commit $source_sha" "$root/$version/SOURCE" || { speech_fail 'Installed source provenance differs'; return 1; }
  (cd "$root/$version" && sha256sum -c SHA256SUMS)
  speech_verify_file "$root/$version/jfk.wav" "$sample_sha"
  speech_measure_headroom benchmark; memory_before=$speech_memory
  smoke=$(mktemp -d "$root/.smoke.XXXXXX")
  chown "vndrly:$group" "$smoke"; chmod 700 "$smoke"
  runuser -u vndrly -- "$ffmpeg" -hide_banner -loglevel error -nostdin -i "$root/$version/jfk.wav" -ac 1 -ar 16000 -c:a pcm_s16le "$smoke/input.wav"
  for tool in first second; do
    timeout --kill-after=2s 30s runuser -u vndrly -- /usr/bin/time -f '%e %M' -o "$smoke/$tool.metrics" "$binary" --model "$model" --file "$smoke/input.wav" --threads 2 --processors 1 --language auto --no-gpu --output-txt --output-file "$smoke/$tool" > "$smoke/$tool.log" 2>&1 &
    if [[ $tool == first ]]; then first_pid=$!; else second_pid=$!; fi
  done
  wait "$first_pid" || failed=1
  wait "$second_pid" || failed=1
  [[ $failed == 0 ]] || { speech_fail "Public sample inference failed; inspect $smoke"; return 1; }
  speech_check_smoke "$smoke/first.txt" "$smoke/first.metrics" "$memory_before"
  speech_check_smoke "$smoke/second.txt" "$smoke/second.metrics" "$memory_before"
  speech_measure_headroom benchmark
  report=$(mktemp "$root/readiness.XXXXXX")
  {
    printf 'verified_at_utc=%s\nsource_commit=%s\nmodel_sha256=%s\n' "$(date -u +%FT%TZ)" "$commit" "$model_sha"
    printf 'memory_before_kib=%s\nmemory_after_kib=%s\ndisk_available_kib=%s\ncores=%s\nload1=%s\n' "$memory_before" "$speech_memory" "$speech_disk" "$speech_cores" "$speech_load"
    printf 'first_seconds_rss_kib='; cat "$smoke/first.metrics"
    printf 'second_seconds_rss_kib='; cat "$smoke/second.metrics"
    "$ffmpeg" -version | awk 'NR==1 {print}'
  } > "$report"
  chmod 444 "$report"
  speech_activate_after_smoke "$env_file" "$binary" "$model" "$ffmpeg" "$smoke" "$memory_before"
  printf 'Native speech verified and enabled for the next API restart. Readiness report: %s\n' "$report"
  printf 'No API restart or deployment was performed. Public smoke evidence: %s\n' "$smoke"
}
if [[ ${BASH_SOURCE[0]} == "$0" ]]; then
  case ${1:-} in
    --check-headroom) shift; [[ $# == 4 ]] || { speech_fail 'Usage: --check-headroom memory_kib disk_kib cores load1'; exit 1; }; speech_check_headroom "$@";;
    --check-smoke) shift; [[ $# == 3 ]] || { speech_fail 'Usage: --check-smoke transcript metrics available_memory_kib'; exit 1; }; speech_check_smoke "$@";;
    '') speech_provision;;
    *) speech_fail 'Usage: sudo bash scripts/provision-native-transcription.sh'; exit 1;;
  esac
fi
