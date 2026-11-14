import type { SuiCodegenConfig } from '@mysten/codegen';

const config: SuiCodegenConfig = {
  output: './src/generated',
  packages: [
    {
      package: '@local-pkg/safe-transfer-escrow',
      path: '..',
    },
  ],
  // packages: [
  //   {
  //     package: '0xfb257f5f2969f978583aa0f70b9610b3e0dedc10db83973bddfd2f1150ff3b45',
  //     packageName: 'safe_transfer_escrow',
  //     network: 'testnet'
  //   }
  // ]
};

export default config;
