Installation
----------------

Dependencies
^^^^^^^^^^^^^

- Specify LLVM path:

  .. code-block:: sh

     npm config set cmake_LLVM_DIR $(path-to-llvm/bin/llvm-config --cmakedir)

     sudo npm config set cmake_LLVM_DIR $(path-to-llvm/bin/llvm-config --cmakedir) --global

Global installation
^^^^^^^^^^^^^^^^^^^^^

- Install Typescriptllvm globally:

  .. code-block:: sh

     sudo -E npm install -g @lungchen/typescriptllvm

  Note that remember to add ``-E`` after ``sudo`` in the above command to ensure
  the custom LLVM setting is copied to the root environment.

  After this step, it can be run globally by the command ``typescriptllvm``.

Local installation
^^^^^^^^^^^^^^^^^^^^

- Install Typescriptllvm locally:

  .. code-block:: sh

     cd typescriptllvm
     npm install @lungchen/typescriptllvm

  After this step, it can be run globally by the command ``npx typescriptllvm``.
