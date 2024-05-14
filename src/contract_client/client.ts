import { ContractSpec, xdr } from "..";
import { Server } from '../soroban';
import { AssembledTransaction } from "./assembled_transaction";
import type { ContractClientOptions, MethodOptions } from "./types";
import { processSpecEntryStream } from './utils';

export class ContractClient {
  /**
   * Generate a class from the contract spec that where each contract method
   * gets included with an identical name.
   *
   * Each method returns an {@link AssembledTransaction} that can be used to
   * modify, simulate, decode results, and possibly sign, & submit the
   * transaction.
   */
  constructor(
    public readonly spec: ContractSpec,
    public readonly options: ContractClientOptions,
  ) {
    this.spec.funcs().forEach((xdrFn) => {
      const method = xdrFn.name().toString();
      const assembleTransaction = (
        args?: Record<string, any>,
        methodOptions?: MethodOptions,
      ) =>
        AssembledTransaction.build({
          method,
          args: args && spec.funcArgsToScVals(method, args),
          ...options,
          ...methodOptions,
          errorTypes: spec.errorCases().reduce(
            (acc, curr) => ({
              ...acc,
              [curr.value()]: { message: curr.doc().toString() },
            }),
            {} as Pick<ContractClientOptions, "errorTypes">,
          ),
          parseResultXdr: (result: xdr.ScVal) =>
            spec.funcResToNative(method, result),
        });

      // @ts-ignore error TS7053: Element implicitly has an 'any' type
      this[method] =
        spec.getFunc(method).inputs().length === 0
          ? (opts?: MethodOptions) => assembleTransaction(undefined, opts)
          : assembleTransaction;
    });
  }

  /**
   * Generates a ContractClient instance from the provided ContractClientOptions and the contract's wasm hash.
   * The wasmHash can be provided in either hex or base64 format.
   * 
   * @param wasmHash The hash of the contract's wasm binary, in either hex or base64 format.
   * @param options The ContractClientOptions object containing the necessary configuration, including the rpcUrl.
   * @param format The format of the provided wasmHash, either "hex" or "base64". Defaults to "hex".
   * @returns A Promise that resolves to a ContractClient instance.
   * @throws {TypeError} If the provided options object does not contain an rpcUrl.
   */
  static async fromWasmHash(wasmHash: Buffer | string, 
    options: ContractClientOptions, 
    format: "hex" | "base64" = "hex"
  ): Promise<ContractClient> {
    if (!options || !options.rpcUrl) {
      throw new TypeError('options must contain rpcUrl');
    }
    const { rpcUrl, allowHttp } = options;
    const serverOpts: Server.Options = { allowHttp };
    const server = new Server(rpcUrl, serverOpts);
    const wasm = await server.getContractWasmByHash(wasmHash, format);
    return ContractClient.fromWasm(wasm, options);
  }

  /**
   * Generates a ContractClient instance from the provided ContractClientOptions and the contract's wasm binary.
   * 
   * @param wasm The contract's wasm binary as a Buffer.
   * @param options The ContractClientOptions object containing the necessary configuration.
   * @returns A Promise that resolves to a ContractClient instance.
   * @throws {Error} If the contract spec cannot be obtained from the provided wasm binary.
   */
  static async fromWasm(wasm: Buffer, options: ContractClientOptions): Promise<ContractClient> {
    const wasmModule = await WebAssembly.compile(wasm);
    const xdrSections = WebAssembly.Module.customSections(wasmModule, "contractspecv0");
    if (xdrSections.length === 0) {
      throw new Error('Could not obtain contract spec from wasm');
    }
    const bufferSection = Buffer.from(xdrSections[0]);
    const specEntryArray = processSpecEntryStream(bufferSection);
    const spec = new ContractSpec(specEntryArray);
    return new ContractClient(spec, options);
  }

  /**
   * Generates a ContractClient instance from the provided ContractClientOptions, which must include the contractId and rpcUrl.
   * 
   * @param options The ContractClientOptions object containing the necessary configuration, including the contractId and rpcUrl.
   * @returns A Promise that resolves to a ContractClient instance.
   * @throws {TypeError} If the provided options object does not contain both rpcUrl and contractId.
   */
  static async from(options: ContractClientOptions): Promise<ContractClient> {
    if (!options || !options.rpcUrl || !options.contractId) {
      throw new TypeError('options must contain rpcUrl and contractId');
    }
    const { rpcUrl, contractId, allowHttp } = options;
    const serverOpts: Server.Options = { allowHttp };
    const server = new Server(rpcUrl, serverOpts);
    const wasm = await server.getContractWasmByContractId(contractId);
    return ContractClient.fromWasm(wasm, options);
  }

  txFromJSON = <T>(json: string): AssembledTransaction<T> => {
    const { method, ...tx } = JSON.parse(json);
    return AssembledTransaction.fromJSON(
      {
        ...this.options,
        method,
        parseResultXdr: (result: xdr.ScVal) =>
          this.spec.funcResToNative(method, result),
      },
      tx,
    );
  };
}

