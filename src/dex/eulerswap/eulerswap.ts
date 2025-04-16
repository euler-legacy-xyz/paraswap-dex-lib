import { AsyncOrSync } from 'ts-essentials';
import {
  Token,
  Address,
  ExchangePrices,
  PoolPrices,
  AdapterExchangeParam,
  SimpleExchangeParam,
  PoolLiquidity,
  Logger,
  NumberAsString,
  DexExchangeParam,
} from '../../types';
import { SwapSide, Network } from '../../constants';
import * as CALLDATA_GAS_COST from '../../calldata-gas-cost';
import { getDexKeysWithNetwork } from '../../utils';
import { IDex } from '../../dex/idex';
import { IDexHelper } from '../../dex-helper/idex-helper';
import {
  EulerswapData,
  EulerswapFunctions,
  EulerswapSimpleSwapParams,
  EulerswapSimpleSwapSellParam,
  EulerswapSimpleSwapBuyParam,
} from './types';
import {
  getLocalDeadlineAsFriendlyPlaceholder,
  SimpleExchange,
} from '../simple-exchange';
import { EulerswapConfig, PoolsToPreload } from './config';
import { EulerswapEventPool } from './eulerswap-pool';
import { Interface } from '@ethersproject/abi';
import ERC20ABI from '../../abi/erc20.json';
import { BytesLike } from '@ethersproject/bytes';
import { MultiResult } from '../../lib/multi-wrapper';
import EulerSwapPoolABI from '../../abi/eulerswap/eulerSwap.abi.json';
import EulerSwapFactoryABI from '../../abi/eulerswap/eulerSwapFactory.abi.json';
import EulerSwapPeripheryABI from '../../abi/eulerswap/eulerSwapPeriphery.abi.json';
import { EulerSwapFactory } from './eulerswap-factory';
import { Contract } from 'web3-eth-contract';
import { SwellData } from '../swell/swell';
import { UniswapV3SimpleSwapParams } from '../uniswap-v3/types';
import { extractReturnAmountPosition } from '../../executor/utils';

export class Eulerswap extends SimpleExchange implements IDex<EulerswapData> {
  // protected eventPools: EulerswapEventPool;
  readonly eventPools: Record<string, EulerswapEventPool | null> = {};

  readonly hasConstantPriceLargeAmounts = false;
  // set true here if protocols works only with wrapped asset
  readonly needWrapNative = true;

  readonly isFeeOnTransferSupported = false;

  readonly poolIface: Interface;
  readonly factoryIface: Interface;
  readonly peripheryIface: Interface;
  private factoryInstance: EulerSwapFactory;
  private peripheryContract: Contract;

  public static dexKeysWithNetwork: { key: string; networks: Network[] }[] =
    getDexKeysWithNetwork(EulerswapConfig);

  logger: Logger;

  constructor(
    readonly network: Network,
    readonly dexKey: string,
    readonly dexHelper: IDexHelper,
    protected config = EulerswapConfig[dexKey][network],
    protected poolsToPreload = PoolsToPreload[dexKey]?.[network] || [],
  ) {
    super(dexHelper, dexKey);
    this.logger = dexHelper.getLogger(dexKey);
    this.poolIface = new Interface(EulerSwapPoolABI);
    this.factoryIface = new Interface(EulerSwapFactoryABI);
    this.peripheryIface = new Interface(EulerSwapPeripheryABI);
    this.factoryInstance = this.getFactoryInstance();
    this.peripheryContract = new this.dexHelper.web3Provider.eth.Contract(
      EulerSwapPeripheryABI as any,
      this.config.periphery,
    );
  }

  protected getFactoryInstance(): EulerSwapFactory {
    return new EulerSwapFactory(
      this.dexHelper,
      this.dexKey,
      this.config.factory,
      this.logger,
      async () => {}, // Empty callback for now
      this.dexKey,
    );
  }

  // Initialize pricing is called once in the start of
  // pricing service. It is intended to setup the integration
  // for pricing requests. It is optional for a DEX to
  // implement this function
  // async initializePricing(blockNumber: number) {
  //   // Initialize the factory to start listening for events
  //   await this.factoryInstance.initialize(blockNumber);
  // }

  // Legacy: was only used for V5
  // Returns the list of contract adapters (name and index)
  // for a buy/sell. Return null if there are no adapters.
  getAdapters(side: SwapSide): { name: string; index: number }[] | null {
    return null;
  }

  // Returns list of pool identifiers that can be used
  // for a given swap. poolIdentifiers must be unique
  // across DEXes. It is recommended to use
  // ${dexKey}_${poolAddress} as a poolIdentifier
  async getPoolIdentifiers(
    srcToken: Token,
    destToken: Token,
    side: SwapSide,
    blockNumber: number,
  ): Promise<string[]> {
    const _srcToken = this.dexHelper.config.wrapETH(srcToken);
    const _destToken = this.dexHelper.config.wrapETH(destToken);

    const [_srcAddress, _destAddress] = this._getLoweredAddresses(
      _srcToken,
      _destToken,
    );

    if (_srcAddress === _destAddress) return [];

    const [asset0, asset1] = this._sortTokens(_srcAddress, _destAddress);

    try {
      // Get all pools for this pair in a single call using factory
      const poolAddresses = await this.factoryInstance.poolsByPair(
        asset0,
        asset1,
        blockNumber,
      );

      // Create pool identifiers for each pool address
      return Promise.all(
        poolAddresses.map((poolAddress: string) =>
          this.getPoolIdentifier(poolAddress),
        ),
      );
    } catch (e) {
      this.logger.error(
        `Error_getPoolIdentifiers: ${_srcAddress} ${_destAddress}`,
        e,
      );
      return [];
    }
  }

  async getPoolIdentifier(poolAddress: Address): Promise<string> {
    return `${this.dexKey}_${poolAddress}`;
  }

  // Returns pool prices for amounts.
  // If limitPools is defined only pools in limitPools
  // should be used. If limitPools is undefined then
  // any pools can be used.
  async getPricesVolume(
    srcToken: Token,
    destToken: Token,
    amounts: bigint[],
    side: SwapSide,
    blockNumber: number,
    limitPools?: string[],
  ): Promise<null | ExchangePrices<EulerswapData>> {
    const _srcToken = this.dexHelper.config.wrapETH(srcToken);
    const _destToken = this.dexHelper.config.wrapETH(destToken);

    const [_srcAddress, _destAddress] = this._getLoweredAddresses(
      _srcToken,
      _destToken,
    );

    if (_srcAddress === _destAddress) return null;

    try {
      let poolAddresses: string[];

      if (limitPools) {
        // If limitPools is provided, extract pool addresses from the identifiers
        poolAddresses = limitPools.map(identifier => {
          const parts = identifier.split('_');
          return parts[1]; // The pool address is the second part after dexKey
        });
      } else {
        const [asset0, asset1] = this._sortTokens(_srcAddress, _destAddress);

        // If no limitPools, get all pools for the pair
        poolAddresses = await this.factoryInstance.poolsByPair(
          asset0,
          asset1,
          blockNumber,
        );
      }

      if (poolAddresses.length === 0) return null;

      const calls = poolAddresses.flatMap(poolAddress =>
        amounts
          .map(amount => {
            // if (amount <= 2000000n) {
            //   return null;
            // }
            return {
              target: this.config.periphery,
              callData:
                side === SwapSide.SELL
                  ? this.peripheryIface.encodeFunctionData('quoteExactInput', [
                      poolAddress,
                      _srcAddress,
                      _destAddress,
                      amount.toString(),
                    ])
                  : this.peripheryIface.encodeFunctionData('quoteExactOutput', [
                      poolAddress,
                      _srcAddress,
                      _destAddress,
                      amount.toString(),
                    ]),
              decodeFunction: (
                returnData: BytesLike | MultiResult<BytesLike>,
              ) => {
                const data =
                  typeof returnData === 'object' && 'success' in returnData
                    ? returnData.returnData
                    : returnData;

                return this.peripheryIface.decodeFunctionResult(
                  side === SwapSide.SELL
                    ? 'quoteExactInput'
                    : 'quoteExactOutput',
                  data,
                )[0];
              },
            };
          })
          .filter((item): item is NonNullable<typeof item> => item !== null),
      );

      const results = await this.dexHelper.multiWrapper.aggregate(calls);
      const unit =
        BigInt(10) **
        BigInt(side === SwapSide.SELL ? destToken.decimals : srcToken.decimals);

      // Group results by pool
      const poolResults = poolAddresses.map((poolAddress, poolIndex) => {
        // Calculate the slice of the results array for this specific pool
        // Since we queried prices for each (pool, amount) combination in a flat array,
        // we need to extract just the portion for the current pool
        const startIndex = poolIndex * amounts.length; // Skip all previous pools' results
        const endIndex = startIndex + amounts.length; // End at the last result for this pool

        // Extract just this pool's price results from the flat results array
        const poolPrices = results
          .slice(startIndex, endIndex)
          .map(result => BigInt(result));

        return {
          unit,
          data: {
            exchange: poolAddress,
          },
          poolAddresses: [poolAddress],
          exchange: this.dexKey,
          gasCost: 0,
          poolIdentifier: `${this.dexKey}_${poolAddress}`,
          prices: poolPrices,
        };
      });
      return poolResults;
    } catch (e) {
      this.logger.error(
        `Error_getPricesVolume: ${_srcAddress} ${_destAddress}`,
        e,
      );
      return null;
    }
  }

  // Returns estimated gas cost of calldata for this DEX in multiSwap
  getCalldataGasCost(poolPrices: PoolPrices<EulerswapData>): number | number[] {
    // Function selector (4 bytes)
    const FUNCTION_SELECTOR = CALLDATA_GAS_COST.FUNCTION_SELECTOR;

    // amount0Out and amount1Out (2 * uint256)
    const AMOUNT = 2 * CALLDATA_GAS_COST.AMOUNT;

    // to address (20 bytes)
    const ADDRESS = CALLDATA_GAS_COST.ADDRESS;

    // data length (1 byte) + data (variable)
    const DATA_LENGTH = CALLDATA_GAS_COST.LENGTH_SMALL;
    const DATA = 0; // We don't know the exact data length, so we'll use 0 as base

    // Total gas cost
    const totalGasCost =
      FUNCTION_SELECTOR + AMOUNT + ADDRESS + DATA_LENGTH + DATA;

    return totalGasCost;
  }

  // Encode params required by the exchange adapter
  // V5: Used for multiSwap, buy & megaSwap
  // V6: Not used, can be left blank
  // Hint: abiCoder.encodeParameter() could be useful
  getAdapterParam(
    srcToken: string,
    destToken: string,
    srcAmount: string,
    destAmount: string,
    data: EulerswapData,
    side: SwapSide,
  ): AdapterExchangeParam {
    let payload;

    if (side === SwapSide.SELL) {
      // const { amountIn, amountOut: amountOutMin } = data;

      // Encode parameters for the adapter
      payload = this.abiCoder.encodeParameter(
        {
          ParentStruct: {
            eulerSwap: 'address',
            tokenIn: 'address',
            tokenOut: 'address',
            amountIn: 'uint256',
            amountOutMin: 'uint256',
          },
        },
        {
          eulerSwap: data.exchange,
          tokenIn: srcToken,
          tokenOut: destToken,
          amountIn: srcAmount,
          amountOutMin: destAmount,
        },
      );
    } else {
      // const { amountIn: amountInMax, amountOut } = data;

      // Encode parameters for the adapter
      payload = this.abiCoder.encodeParameter(
        {
          ParentStruct: {
            eulerSwap: 'address',
            tokenIn: 'address',
            tokenOut: 'address',
            amountOut: 'uint256',
            amountInMax: 'uint256',
          },
        },
        {
          eulerSwap: data.exchange,
          tokenIn: srcToken,
          tokenOut: destToken,
          amountOut: destAmount,
          amountInMax: srcAmount,
        },
      );
    }
    return {
      targetExchange: this.config.periphery,
      payload,
      networkFee: '0',
    };
  }

  getDexParam(
    srcToken: Address,
    destToken: Address,
    srcAmount: NumberAsString,
    destAmount: NumberAsString,
    recipient: Address,
    data: EulerswapData,
    side: SwapSide,
  ): DexExchangeParam {
    const swapFunction =
      side === SwapSide.SELL
        ? EulerswapFunctions.exactInput
        : EulerswapFunctions.exactOutput;

    const swapFunctionParams: EulerswapSimpleSwapParams =
      side === SwapSide.SELL
        ? {
            eulerSwap: data.exchange,
            tokenIn: srcToken,
            tokenOut: destToken,
            amountIn: srcAmount,
            amountOutMin: destAmount,
          }
        : {
            eulerSwap: data.exchange,
            tokenIn: srcToken,
            tokenOut: destToken,
            amountOut: destAmount,
            amountInMax: srcAmount,
          };

    let params: any[];

    if (side === SwapSide.SELL) {
      const sellParams = swapFunctionParams as EulerswapSimpleSwapSellParam;
      params = [
        sellParams.eulerSwap,
        sellParams.tokenIn,
        sellParams.tokenOut,
        sellParams.amountIn,
        sellParams.amountOutMin,
      ];
    } else {
      const buyParams = swapFunctionParams as EulerswapSimpleSwapBuyParam;
      params = [
        buyParams.eulerSwap,
        buyParams.tokenIn,
        buyParams.tokenOut,
        buyParams.amountOut,
        buyParams.amountInMax,
      ];
    }

    const exchangeData = this.peripheryIface.encodeFunctionData(
      swapFunction,
      params,
    );

    return {
      needWrapNative: this.needWrapNative,
      dexFuncHasRecipient: false,
      exchangeData,
      targetExchange: this.config.periphery,
      returnAmountPos: undefined,
      skipApproval: false,
      permit2Approval: true,
    };
  }

  // This is called once before getTopPoolsForToken is
  // called for multiple tokens. This can be helpful to
  // update common state required for calculating
  // getTopPoolsForToken. It is optional for a DEX
  // to implement this
  // async updatePoolState(): Promise<void> {
  //   // TODO: complete me!
  // }

  // Returns list of top pools based on liquidity. Max
  // limit number pools should be returned.
  async getTopPoolsForToken(
    tokenAddress: Address,
    limit: number,
  ): Promise<PoolLiquidity[]> {
    //TODO: complete me!
    return [];
  }

  protected _getLoweredAddresses(srcToken: Token, destToken: Token) {
    return [srcToken.address.toLowerCase(), destToken.address.toLowerCase()];
  }

  protected _sortTokens(srcAddress: Address, destAddress: Address) {
    return [srcAddress, destAddress].sort((a, b) => (a < b ? -1 : 1));
  }
}
