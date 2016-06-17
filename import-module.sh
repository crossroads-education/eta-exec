#!/bin/sh

# Parameters: github_repo dirname

# Pulled from http://stackoverflow.com/a/25394801
# We still need this.
windows() { [[ -n "$WINDIR" ]]; }

# Cross-platform symlink function. With one parameter, it will check
# whether the parameter is a symlink. With two parameters, it will create
# a symlink to a file or directory, with syntax: link $linkname $target
link() {
    if [[ -z "$2" ]]; then
        # Link-checking mode.
        if windows; then
            fsutil reparsepoint query "$1" > /dev/null
        else
            [[ -h "$1" ]]
        fi
    else
        # Link-creation mode.
        if windows; then
            # Windows needs to be told if it's a directory or not. Infer that.
            # Also: note that we convert `/` to `\`. In this case it's necessary.
            if [[ -d "$2" ]]; then
                cmd <<< "mklink /J \"$1\" \"${2//\//\\}\"" > /dev/null
            else
                cmd <<< "mklink \"$1\" \"${2//\//\\}\"" > /dev/null
            fi
        else
            # You know what? I think ln's parameters are backwards.
            ln -s "$2" "$1"
        fi
    fi
}
# end stackoverflow guy's code

# Start in exec
clone() {
    cd ".."
    git clone "$1" "$2"
    cd "exec"
}

link_() {
    mkdir -p "modules"
    cd "modules"
    link "$1" "../../$1"
    cd ".."
}

compile() {
    cd "../$1"
    typings i
    mkdir "node_modules"
    cd "node_modules"
    link "eta-lib" "../../lib/"
    cd ".."
    tsc
    cd "../exec"
}

echo "Cloning $1 to $2"
clone "$1" "$2"
echo "Linking $2"
link_ "$2"
echo "Compiling $2"
compile "$2"
