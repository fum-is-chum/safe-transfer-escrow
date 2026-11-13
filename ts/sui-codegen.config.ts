import type { SuiCodegenConfig } from '@mysten/codegen';

const config: SuiCodegenConfig = {
  output: './src/generated',
  packages: [
    {
      package: '@local-pkg/safe-transfer-escrow',
      path: '..',
    },
  ],
};

export default config;
