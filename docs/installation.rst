Installation
----------------

Dependencies
^^^^^^^^^^^^^

- Specify LLVM path:

  .. code-block:: sh

     npm config set cmake_LLVM_DIR $(path-to-llvm/bin/llvm-config --cmakedir)

Global installation
^^^^^^^^^^^^^^^^^^^^^

- Install Typescriptllvm globally:

  .. code-block:: sh

     sudo npm install -g @lungchen/typescriptllvm

  After this step, it can be run globally by the command ``typescriptllvm``

Local installation
^^^^^^^^^^^^^^^^^^^^

- Install Typescriptllvm locally:

  .. code-block:: sh

     cd typescriptllvm
     npm install @lungchen/typescriptllvm

  After this step, it can be run globally by the command ``npx typescriptllvm``.
