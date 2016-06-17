#!/bin/sh

pull_compile() {
    echo "Pulling and compiling "`basename "$PWD"`
    git pull
    typings i
    tsc
}

# Lib
cd "node_modules/eta-lib"
pull_compile

# Exec
cd "../.." # From eta-lib
pull_compile

# Modules
cd "modules"
for D in `find . -type l`
do
    cd "${D}"
    pull_compile
    cd ".."
done
