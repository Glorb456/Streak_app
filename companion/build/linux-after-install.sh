#!/bin/bash
# Streak Companion .deb post-install. This is electron-builder's stock
# after-install template plus one extra check at the end. NOTE: dollar-brace
# placeholders are expanded by electron-builder at build time and must be
# ones it knows (executable, sanitizedProductName); use $VAR without braces
# for real shell variables.

if type update-alternatives 2>/dev/null >&1; then
    # Remove previous link if it doesn't use update-alternatives
    if [ -L '/usr/bin/${executable}' -a -e '/usr/bin/${executable}' -a "`readlink '/usr/bin/${executable}'`" != '/etc/alternatives/${executable}' ]; then
        rm -f '/usr/bin/${executable}'
    fi
    update-alternatives --install '/usr/bin/${executable}' '${executable}' '/opt/${sanitizedProductName}/${executable}' 100 || ln -sf '/opt/${sanitizedProductName}/${executable}' '/usr/bin/${executable}'
else
    ln -sf '/opt/${sanitizedProductName}/${executable}' '/usr/bin/${executable}'
fi

# Check if user namespaces are supported by the kernel and working with a quick test:
if ! { [[ -L /proc/self/ns/user ]] && unshare --user true; }; then
    # Use SUID chrome-sandbox only on systems without user namespaces:
    chmod 4755 '/opt/${sanitizedProductName}/chrome-sandbox' || true
else
    chmod 0755 '/opt/${sanitizedProductName}/chrome-sandbox' || true
fi

# Ubuntu 24.04+ (and Mint 22+) restrict unprivileged user namespaces via
# AppArmor. The test above runs as root so it passes, but the unprivileged
# app then can't build Chromium's namespace sandbox and refuses to start
# ("The SUID sandbox helper binary was found, but is not configured
# correctly"). On those systems fall back to the setuid sandbox helper.
RESTRICT=$(cat /proc/sys/kernel/apparmor_restrict_unprivileged_userns 2>/dev/null || echo 0)
if [ "$RESTRICT" = "1" ]; then
    chmod 4755 '/opt/${sanitizedProductName}/chrome-sandbox' || true
fi

if hash update-mime-database 2>/dev/null; then
    update-mime-database /usr/share/mime || true
fi

if hash update-desktop-database 2>/dev/null; then
    update-desktop-database /usr/share/applications || true
fi
