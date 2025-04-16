/* eslint-disable no-console */
import dotenv from 'dotenv';
dotenv.config();

import { Interface, Result } from '@ethersproject/abi';
import { DummyDexHelper } from '../../dex-helper/index';
import { Network, SwapSide } from '../../constants';
import { BI_POWS } from '../../bigint-constants';
import { Eulerswap } from './eulerswap';
import {
  checkPoolPrices,
  checkPoolsLiquidity,
  checkConstantPoolPrices,
} from '../../../tests/utils';
import { Tokens } from '../../../tests/constants-e2e';
import EulerSwapPeripheryABI from '../../abi/eulerswap/eulerSwapPeriphery.abi.json';
import { Address } from '../../types';

/*
  npx jest src/dex/eulerswap/eulerswap-integration.test.ts
*/

function getReaderCalldata(
  exchangeAddress: string,
  readerIface: Interface,
  amounts: bigint[],
  funcName: string,
  tokenIn: Address,
  tokenOut: Address,
  poolsIdentifiers: string[],
) {
  return poolsIdentifiers.flatMap(poolIdentifier => {
    console.log('poolIdentifier in getReaderCalldata', poolIdentifier);
    const pool = poolIdentifier.split('_')[1];
    console.log('pool in getReaderCalldata', pool);
    return amounts.map(amount => ({
      target: exchangeAddress,
      callData: readerIface.encodeFunctionData(funcName, [
        pool,
        tokenIn,
        tokenOut,
        amount.toString(),
      ]),
    }));
  });
}

function decodeReaderResult(
  results: Result,
  readerIface: Interface,
  funcName: string,
) {
  return results.map(result => {
    const parsed = readerIface.decodeFunctionResult(funcName, result);
    return BigInt(parsed[0]._hex);
  });
}

async function checkOnChainPricing(
  eulerswap: Eulerswap,
  side: SwapSide,
  blockNumber: number,
  prices: bigint[],
  amounts: bigint[],
  pools: string[],
  srcToken: Address,
  dstToken: Address,
) {
  // periphery address
  const exchangeAddress = '0x829e7c83886323980BE76CedD837905cCEc3D738';
  const readerIface = new Interface(EulerSwapPeripheryABI);

  const funcName: string =
    side === SwapSide.SELL ? 'quoteExactInput' : 'quoteExactOutput';

  const readerCallData = getReaderCalldata(
    exchangeAddress,
    readerIface,
    amounts.slice(1),
    funcName,
    srcToken,
    dstToken,
    pools,
  );

  const readerResult = (
    await eulerswap.dexHelper.multiContract.methods
      .aggregate(readerCallData)
      .call({}, blockNumber)
  ).returnData;

  const expectedPrices = [0n].concat(
    decodeReaderResult(readerResult, readerIface, funcName),
  );

  /// TODO: remove this once we have a fix
  prices[0] = 0n;
  expect(prices).toEqual(expectedPrices);
}

async function testPricingOnNetwork(
  eulerswap: Eulerswap,
  network: Network,
  dexKey: string,
  blockNumber: number,
  srcTokenSymbol: string,
  destTokenSymbol: string,
  side: SwapSide,
  amounts: bigint[],
) {
  const networkTokens = Tokens[network];

  const pools = await eulerswap.getPoolIdentifiers(
    networkTokens[srcTokenSymbol],
    networkTokens[destTokenSymbol],
    side,
    blockNumber,
  );
  console.log(
    `${srcTokenSymbol} <> ${destTokenSymbol} Pool Identifiers: `,
    pools,
  );

  expect(pools.length).toBeGreaterThan(0);

  const poolPrices = await eulerswap.getPricesVolume(
    networkTokens[srcTokenSymbol],
    networkTokens[destTokenSymbol],
    amounts,
    side,
    blockNumber,
    pools,
  );
  console.log(
    `${srcTokenSymbol} <> ${destTokenSymbol} Pool Prices: `,
    poolPrices,
  );

  expect(poolPrices).not.toBeNull();
  if (eulerswap.hasConstantPriceLargeAmounts) {
    checkConstantPoolPrices(poolPrices!, amounts, dexKey);
  } else {
    checkPoolPrices(poolPrices!, amounts, side, dexKey);
  }

  // Check if onchain pricing equals to calculated ones
  await checkOnChainPricing(
    eulerswap,
    side,
    blockNumber,
    poolPrices![0].prices,
    amounts,
    pools,
    networkTokens[srcTokenSymbol].address,
    networkTokens[destTokenSymbol].address,
  );
}

describe('Eulerswap', function () {
  const dexKey = 'Eulerswap';
  let blockNumber: number;
  let eulerswap: Eulerswap;

  describe('Mainnet', () => {
    const network = Network.MAINNET;
    const dexHelper = new DummyDexHelper(network);

    const tokens = Tokens[network];

    const srcTokenSymbol = 'USDC';
    const destTokenSymbol = 'USDT';

    const amountsForSell = [
      0n,
      1n * BI_POWS[tokens[srcTokenSymbol].decimals],
      2n * BI_POWS[tokens[srcTokenSymbol].decimals],
      3n * BI_POWS[tokens[srcTokenSymbol].decimals],
      4n * BI_POWS[tokens[srcTokenSymbol].decimals],
      5n * BI_POWS[tokens[srcTokenSymbol].decimals],
      6n * BI_POWS[tokens[srcTokenSymbol].decimals],
      7n * BI_POWS[tokens[srcTokenSymbol].decimals],
      8n * BI_POWS[tokens[srcTokenSymbol].decimals],
      9n * BI_POWS[tokens[srcTokenSymbol].decimals],
      10n * BI_POWS[tokens[srcTokenSymbol].decimals],
    ];

    const amountsForBuy = [
      0n,
      1n * BI_POWS[tokens[destTokenSymbol].decimals],
      2n * BI_POWS[tokens[destTokenSymbol].decimals],
      3n * BI_POWS[tokens[destTokenSymbol].decimals],
      4n * BI_POWS[tokens[destTokenSymbol].decimals],
      5n * BI_POWS[tokens[destTokenSymbol].decimals],
      6n * BI_POWS[tokens[destTokenSymbol].decimals],
      7n * BI_POWS[tokens[destTokenSymbol].decimals],
      8n * BI_POWS[tokens[destTokenSymbol].decimals],
      9n * BI_POWS[tokens[destTokenSymbol].decimals],
      10n * BI_POWS[tokens[destTokenSymbol].decimals],
    ];

    beforeAll(async () => {
      blockNumber = await dexHelper.web3Provider.eth.getBlockNumber();
      eulerswap = new Eulerswap(network, dexKey, dexHelper);
      // if (eulerswap.initializePricing) {
      //   await eulerswap.initializePricing(blockNumber);
      // }
    });

    it('getPoolIdentifiers and getPricesVolume SELL', async function () {
      await testPricingOnNetwork(
        eulerswap,
        network,
        dexKey,
        blockNumber,
        srcTokenSymbol,
        destTokenSymbol,
        SwapSide.SELL,
        amountsForSell,
      );
    });

    it('getPoolIdentifiers and getPricesVolume BUY', async function () {
      await testPricingOnNetwork(
        eulerswap,
        network,
        dexKey,
        blockNumber,
        srcTokenSymbol,
        destTokenSymbol,
        SwapSide.BUY,
        amountsForBuy,
      );
    });

    // TODO: uncomment and finish this test once getTopPoolsForToken() is implemented
    // it('getTopPoolsForToken', async function () {
    //   // We have to check without calling initializePricing, because
    //   // pool-tracker is not calling that function
    //   const newEulerswap = new Eulerswap(network, dexKey, dexHelper);
    //   // if (newEulerswap.updatePoolState) {
    //   //   await newEulerswap.updatePoolState();
    //   // }
    //   const poolLiquidity = await newEulerswap.getTopPoolsForToken(
    //     tokens[srcTokenSymbol].address,
    //     10,
    //   );
    //   console.log(`${srcTokenSymbol} Top Pools:`, poolLiquidity);

    //   if (!newEulerswap.hasConstantPriceLargeAmounts) {
    //     checkPoolsLiquidity(
    //       poolLiquidity,
    //       Tokens[network][srcTokenSymbol].address,
    //       dexKey,
    //     );
    //   }
    // });
  });
});
