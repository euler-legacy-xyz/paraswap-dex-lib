/* eslint-disable no-console */
import dotenv from 'dotenv';
dotenv.config();

import { EulerswapEventPool } from './eulerswap-pool';
import { Network } from '../../constants';
import { Address } from '../../types';
import { DummyDexHelper } from '../../dex-helper/index';
import { testEventSubscriber } from '../../../tests/utils-events';
import { PoolState } from './types';
import { Interface } from '@ethersproject/abi';
import ERC20ABI from '../../abi/erc20.json';

/*
  README
  ======

  This test script adds unit tests for Eulerswap event based
  system. This is done by fetching the state on-chain before the
  event block, manually pushing the block logs to the event-subscriber,
  comparing the local state with on-chain state.

  Most of the logic for testing is abstracted by `testEventSubscriber`.
  You need to do two things to make the tests work:

  1. Fetch the block numbers where certain events were released. You
  can modify the `./scripts/fetch-event-blocknumber.ts` to get the
  block numbers for different events. Make sure to get sufficient
  number of blockNumbers to cover all possible cases for the event
  mutations.

  2. Complete the implementation for fetchPoolState function. The
  function should fetch the on-chain state of the event subscriber
  using just the blocknumber.

  The template tests only include the test for a single event
  subscriber. There can be cases where multiple event subscribers
  exist for a single DEX. In such cases additional tests should be
  added.

  You can run this individual test script by running:
  `npx jest src/dex/<dex-name>/<dex-name>-events.test.ts`

  (This comment should be removed from the final implementation)
*/

jest.setTimeout(50 * 1000);

async function fetchPoolState(
  eulerswapPools: EulerswapEventPool,
  blockNumber: number,
  poolAddress: string,
): Promise<PoolState> {
  const message = `EulerSwap: ${poolAddress} blockNumber ${blockNumber}`;
  console.log(`Fetching state ${message}`);

  const state = eulerswapPools.generateState(blockNumber);
  console.log(`Done ${message}`);
  return state;
}

// eventName -> blockNumbers
type EventMappings = Record<string, number[]>;

describe('Eulerswap EventPool Mainnet', function () {
  const dexKey = 'Eulerswap';
  const network = Network.MAINNET;
  const dexHelper = new DummyDexHelper(network);
  const logger = dexHelper.getLogger(dexKey);

  const factoryAddress = '0xF75548aF02f1928CbE9015985D4Fcbf96d728544';
  const asset0 = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'; // USDC
  const asset1 = '0xdAC17F958D2ee523a2206206994597C13D831ec7'; // USDT
  const poolAddress = '0x2bFED8dBEb8e6226a15300AC77eE9130E52410fE';
  const poolInitCodeHash =
    '0xcc469c6a985bd7c7c9f42991e8bf16ce2bfdfe7cc4158f555afb89ca75bd7b53';
  let eulerswapPool: EulerswapEventPool;

  // poolAddress -> EventMappings
  const eventsToTest: Record<Address, EventMappings> = {
    [poolAddress]: {
      Swap: [21986064],
    },
  };

  beforeEach(async () => {
    eulerswapPool = new EulerswapEventPool(
      dexKey,
      network,
      dexHelper,
      logger,
      new Interface(ERC20ABI),
      factoryAddress,
      asset0,
      asset1,
      poolInitCodeHash,
    );

    // Initialize the pool address and subscribed addresses
    eulerswapPool.poolAddress = poolAddress;
    eulerswapPool.addressesSubscribed[0] = poolAddress;
  });

  Object.entries(eventsToTest).forEach(
    ([poolAddress, events]: [string, EventMappings]) => {
      describe(`Events for ${poolAddress}`, () => {
        Object.entries(events).forEach(
          ([eventName, blockNumbers]: [string, number[]]) => {
            describe(`${eventName}`, () => {
              blockNumbers.forEach((blockNumber: number) => {
                it(`State after ${blockNumber}`, async function () {
                  await testEventSubscriber(
                    eulerswapPool,
                    eulerswapPool.addressesSubscribed,
                    (_blockNumber: number) =>
                      fetchPoolState(eulerswapPool, _blockNumber, poolAddress),
                    blockNumber,
                    `${dexKey}_${poolAddress}`,
                    dexHelper.provider,
                  );
                });
              });
            });
          },
        );
      });
    },
  );
});
