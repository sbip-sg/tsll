Installation
----------------

- Specify LLVM path:

  .. code-block:: sh

     npm config set cmake_LLVM_DIR $(path-to-llvm/bin/llvm-config --cmakedir)

- Install Typescriptllvm globally:

  .. code-block:: sh

     sudo npm install -g @lungchen/typescriptllvm

- Run Typescriptllvm directly:

  .. code-block:: sh

     npm start test/doStatement.ts

  + Check also ``package.json`` and ``lib/cli.js``
