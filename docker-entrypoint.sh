#!/bin/sh
#
# Container entrypoint: provision the SSH key used for git push / pull, then
# hand over to gunicorn (the CMD holds gunicorn's arguments).
#
# The key lives in the data volume so it survives container re-creation; it is
# generated on first start. Its public key is logged on every start, so it can
# be added as a deploy key to the git remotes.

set -eu

ssh_dir="${TINO_SSH_DIR:-${TINO_DATA_DIR}/ssh}"
key="${ssh_dir}/id_ed25519"

if [ ! -f "${key}" ]; then
    if mkdir -p "${ssh_dir}" && chmod 700 "${ssh_dir}" \
        && ssh-keygen -q -t ed25519 -N '' -C 'tino' -f "${key}"; then
        echo "Generated SSH key ${key}"
    else
        echo "Could not generate an SSH key in ${ssh_dir}, git over SSH is unavailable" >&2
    fi
fi

if [ -f "${key}.pub" ]; then
    echo "SSH public key (add it as a deploy key to your git remotes):"
    cat "${key}.pub"
fi

# BatchMode keeps ssh from waiting for a prompt nobody can answer, and
# accept-new trusts a host on first contact (remembered in the data volume).
: "${GIT_SSH_COMMAND:=ssh -i '${key}' -o IdentitiesOnly=yes -o BatchMode=yes -o StrictHostKeyChecking=accept-new -o UserKnownHostsFile='${ssh_dir}/known_hosts'}"
export GIT_SSH_COMMAND

exec gunicorn "$@"
