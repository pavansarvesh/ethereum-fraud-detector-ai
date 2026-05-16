from blockchain.connect import get_contract

contract = get_contract()
if contract is not None:
    record = contract.functions.getTransaction("0xe4b96e15e3df630fea7d80ec48c615d00fbe5b56a2b72bc24706edd3a2884ed0").call()
    print(record)
else:
    print("Error: Could not connect to contract")