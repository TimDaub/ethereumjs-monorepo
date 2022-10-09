/* eslint @typescript-eslint/no-unused-vars: 0 */

import { arrToBufArr, setLengthRight, toBuffer } from '@ethereumjs/util'

import { Cache } from './cache'

import { BaseStateManager } from '.'

import type { StateManager } from '.'
import type { getCb, putCb } from './cache'
import type { StorageDump } from './interface'
import type { Common } from '@ethereumjs/common'
import type { Address, PrefixedHexString } from '@ethereumjs/util'

const wasm = require('../../../rust-verkle-wasm/rust_verkle_wasm')

export interface VerkleState {
  [key: PrefixedHexString]: PrefixedHexString
}

/**
 * Options dictionary.
 */
export interface StatelessVerkleStateManagerOpts {}

/**
 * Tree key constants.
 */
const BALANCE_LEAF_KEY = 1

/**
 * Default StateManager implementation for the VM.
 *
 * The state manager abstracts from the underlying data store
 * by providing higher level access to accounts, contract code
 * and storage slots.
 *
 * The default state manager implementation uses a
 * `merkle-patricia-tree` trie as a data backend.
 */
export class StatelessVerkleStateManager extends BaseStateManager implements StateManager {
  private _proof: PrefixedHexString = '0x'

  // Pre-state (should not change)
  private _preState: VerkleState = {}

  // State along execution (should update)
  private _state: VerkleState = {}

  // Checkpointing
  private _checkpoints: VerkleState[] = []

  /**
   * Instantiate the StateManager interface.
   */
  constructor(opts: StatelessVerkleStateManagerOpts = {}) {
    super(opts)

    /*
     * For a custom StateManager implementation adopt these
     * callbacks passed to the `Cache` instantiated to perform
     * the `get`, `put` and `delete` operations with the
     * desired backend.
     */
    const getCb: getCb = async (address) => {
      console.log(`Calling get_tree_key_for_balance() on address ${address.toString()}`)
      this.getTreeKeyForBalance(address)
      return undefined
    }
    const putCb: putCb = async (keyBuf, accountRlp) => {}
    const deleteCb = async (keyBuf: Buffer) => {}
    this._cache = new Cache({ getCb, putCb, deleteCb })
  }

  public async initPreState(proof: PrefixedHexString, preState: VerkleState) {
    this._proof = proof
    // Set new pre-state
    this._preState = preState
    // Initialize the state with the pre-state
    this._state = preState
  }

  private pedersenHash(input: Buffer) {
    // max length 255 * 16
    if (input.length > 4080) {
      throw new Error(
        'Input buffer for perdersonHash calculation in verkle state manager too long.'
      )
    }
    const extInput = setLengthRight(input, 4080)
    console.log(`ext_input (byte length: ${extInput.length})`)

    console.log(`${extInput.toString('hex').substring(0, 100)}...`)
    const ints: Array<number | ArrayBufferLike> = [2 + 256 * input.length]
    console.log(`Value for ints[0]: ${ints[0]}`)
    for (let i = 0; i <= 254; i++) {
      const from = 16 * i
      const to = 16 * (i + 1)
      const newInt = extInput.slice(from, to)
      ints.push(newInt)
    }
    console.log(`ints Length: ${ints.length}`)
    console.log(`Value for ints[1] (Buffer): 0x${(ints[1] as Buffer).toString('hex')}`)
    console.log(`Value for ints[2] (Buffer): 0x${(ints[2] as Buffer).toString('hex')}`)
    const pedersenHash = wasm.pedersen_hash(ints)
    console.log(
      `Value for pederson_hash() (compute_commitment_root(ints).serialize()): ${arrToBufArr(
        pedersenHash
      ).toString('hex')}`
    )
    return arrToBufArr(pedersenHash)
  }

  private getTreeKey(address: Address, treeIndex: number, subIndex: number) {
    console.log(
      `get_tree_key() called with address=${address.toString()} tree_index=${treeIndex} sub_index=${subIndex}`
    )
    const treeIndexB = Buffer.alloc(32)
    treeIndexB.writeInt32LE(treeIndex)

    const input = Buffer.concat([address.toBuffer(), treeIndexB])
    console.log(`Input to perderson_hash() call (address + tree_index.to_bytes(32, 'little')):`)
    console.log(input.toString('hex'))
    const ret = Buffer.concat([this.pedersenHash(input).slice(0, 31), toBuffer(subIndex)])
    console.log(`Return value for getTreeKey() (Buffer): 0x${ret.toString('hex')}`)
    return ret
  }

  private getTreeKeyForBalance(address: Address) {
    return this.getTreeKey(address, 0, BALANCE_LEAF_KEY)
  }

  /**
   * Copies the current instance of the `StateManager`
   * at the last fully committed point, i.e. as if all current
   * checkpoints were reverted.
   */
  copy(): StateManager {
    return new StatelessVerkleStateManager({})
  }

  /**
   * Adds `value` to the state trie as code, and sets `codeHash` on the account
   * corresponding to `address` to reference this.
   * @param address - Address of the `account` to add the `code` for
   * @param value - The value of the `code`
   */
  async putContractCode(address: Address, value: Buffer): Promise<void> {}

  /**
   * Gets the code corresponding to the provided `address`.
   * @param address - Address to get the `code` for
   * @returns {Promise<Buffer>} -  Resolves with the code corresponding to the provided address.
   * Returns an empty `Buffer` if the account has no associated code.
   */
  async getContractCode(address: Address): Promise<Buffer> {
    return Buffer.alloc(0)
  }

  /**
   * Gets the storage value associated with the provided `address` and `key`. This method returns
   * the shortest representation of the stored value.
   * @param address -  Address of the account to get the storage for
   * @param key - Key in the account's storage to get the value for. Must be 32 bytes long.
   * @returns {Promise<Buffer>} - The storage value for the account
   * corresponding to the provided address at the provided key.
   * If this does not exist an empty `Buffer` is returned.
   */
  async getContractStorage(address: Address, key: Buffer): Promise<Buffer> {
    return Buffer.alloc(0)
  }

  /**
   * Adds value to the state for the `account`
   * corresponding to `address` at the provided `key`.
   * @param address -  Address to set a storage value for
   * @param key - Key to set the value at. Must be 32 bytes long.
   * @param value - Value to set at `key` for account corresponding to `address`. Cannot be more than 32 bytes. Leading zeros are stripped. If it is a empty or filled with zeros, deletes the value.
   */
  async putContractStorage(address: Address, key: Buffer, value: Buffer): Promise<void> {}

  /**
   * Clears all storage entries for the account corresponding to `address`.
   * @param address -  Address to clear the storage of
   */
  async clearContractStorage(address: Address): Promise<void> {}

  /**
   * Checkpoints the current state of the StateManager instance.
   * State changes that follow can then be committed by calling
   * `commit` or `reverted` by calling rollback.
   */
  async checkpoint(): Promise<void> {
    this._checkpoints.push(this._state)
    await super.checkpoint()
  }

  /**
   * Commits the current change-set to the instance since the
   * last call to checkpoint.
   */
  async commit(): Promise<void> {
    this._checkpoints.pop()
    await super.commit()
  }

  // TODO
  async hasStateRoot(root: Buffer): Promise<boolean> {
    return true
  }

  /**
   * Reverts the current change-set to the instance since the
   * last call to checkpoint.
   */
  async revert(): Promise<void> {
    if (this._checkpoints.length === 0) {
      throw new Error('StatelessVerkleStateManager state cannot be reverted, no checkpoints set')
    }
    this._state = this._checkpoints.pop()!
    await super.revert()
  }

  /**
   * Gets the verkle root.
   * NOTE: this needs some examination in the code where this is needed
   * and if we have the verkle root present
   * @returns {Promise<Buffer>} - Returns the verkle root of the `StateManager`
   */
  async getStateRoot(): Promise<Buffer> {
    return Buffer.alloc(0)
  }

  /**
   * TODO: needed?
   * Maybe in this contex: reset to original pre state suffice
   * @param stateRoot - The verkle root to reset the instance to
   */
  async setStateRoot(stateRoot: Buffer): Promise<void> {}

  /**
   * Dumps the RLP-encoded storage values for an `account` specified by `address`.
   * @param address - The address of the `account` to return storage for
   * @returns {Promise<StorageDump>} - The state of the account as an `Object` map.
   * Keys are are the storage keys, values are the storage values as strings.
   * Both are represented as hex strings without the `0x` prefix.
   */
  async dumpStorage(address: Address): Promise<StorageDump> {
    return { test: 'test' }
  }

  /**
   * Checks whether the current instance has the canonical genesis state
   * for the configured chain parameters.
   * @returns {Promise<boolean>} - Whether the storage trie contains the
   * canonical genesis state for the configured chain parameters.
   */
  async hasGenesisState(): Promise<boolean> {
    return false
  }

  /**
   * Checks if the `account` corresponding to `address`
   * exists
   * @param address - Address of the `account` to check
   */
  async accountExists(address: Address): Promise<boolean> {
    return false
  }
}