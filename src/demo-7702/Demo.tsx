import React, { useState, useCallback, useEffect } from 'react'
import {
    createPublicClient,
    createWalletClient,
    http,
    custom,
    parseEther,
} from 'viem'
import { mainnet, sepolia, gnosis } from 'viem/chains'
import { createPimlicoClient } from 'permissionless/clients/pimlico'
import { entryPoint08Address } from 'viem/account-abstraction'
import {
    Container,
    Typography,
    Button,
    Select,
    MenuItem,
    FormControl,
    InputLabel,
    Paper,
    Box,
    TextField,
    IconButton,
    Link,
    Alert,
    SelectChangeEvent,
    Switch,
    FormControlLabel,
} from '@mui/material'
import DeleteIcon from '@mui/icons-material/Delete'
import AddIcon from '@mui/icons-material/Add'
import { PIMLICO_API_KEY } from '../config'

declare global {
    interface Window {
        ethereum: any;
    }
}

// Network configurations
const NETWORKS: { [key: string]: { name: string; chain: any; explorerUrl: string } } = {
    '0x1': {
        name: 'Ethereum Mainnet',
        chain: mainnet,
        explorerUrl: 'https://etherscan.io/tx',
    },
    '0xaa36a7': {
        name: 'Sepolia',
        chain: sepolia,
        explorerUrl: 'https://sepolia.etherscan.io/tx',
    },
    '0x64': {
        name: 'Gnosis',
        chain: gnosis,
        explorerUrl: 'https://gnosisscan.io/tx',
    },
}

// Configuration Constants
const ENTRYPOINT_ADDRESS = entryPoint08Address
const PIMLICO_URL = `https://api.pimlico.io/v2/${sepolia.id}/rpc?apikey=${PIMLICO_API_KEY}`

interface Transaction {
    to: string;
    value: string;
    data: string;
}

export function Demo() {
    const [status, setStatus] = useState<string>('Please connect your wallet to continue.')
    const [statusClass, setStatusClass] = useState<string>('info')
    const [selectedNetwork, setSelectedNetwork] = useState<string>('0xaa36a7')
    const [connectedAddress, setConnectedAddress] = useState<string>('')
    const [transactions, setTransactions] = useState<Transaction[]>(() => {
        const saved = localStorage.getItem('bundledTransactions')
        return saved ? JSON.parse(saved) : []
    })
    const [txHash, setTxHash] = useState<string>('')
    const [isExecuting, setIsExecuting] = useState(false)
    const [paymasterUrl, setPaymasterUrl] = useState<string>(() => {
        return localStorage.getItem('paymasterUrl') || ''
    })
    const [isPaymasterOptional, setIsPaymasterOptional] = useState<boolean>(() => {
        return localStorage.getItem('isPaymasterOptional') === 'true'
    })
    const [clients, setClients] = useState<{
        walletClient: any;
        publicClient: any;
        pimlicoClient: any;
    } | null>(null)

    // Save transactions to localStorage whenever they change
    useEffect(() => {
        localStorage.setItem('bundledTransactions', JSON.stringify(transactions))
    }, [transactions])

    // Save paymaster settings to localStorage whenever they change
    useEffect(() => {
        localStorage.setItem('paymasterUrl', paymasterUrl)
        localStorage.setItem('isPaymasterOptional', isPaymasterOptional.toString())
    }, [paymasterUrl, isPaymasterOptional])

    const initializeClients = useCallback(async () => {
        if (typeof window === 'undefined' || !window.ethereum) {
            throw new Error('MetaMask not found. Please install MetaMask and refresh the page.')
        }

        try {
            const network = NETWORKS[selectedNetwork]
            const walletClient = createWalletClient({
                chain: network.chain,
                transport: custom(window.ethereum)
            })

            const publicClient = createPublicClient({
                chain: network.chain,
                transport: http()
            })

            const pimlicoClient = createPimlicoClient({
                transport: http(PIMLICO_URL, {
                    fetchOptions: {
                        headers: {
                            'x-secret-key': PIMLICO_API_KEY
                        } as HeadersInit
                    }
                })
            })

            setClients({ walletClient, publicClient, pimlicoClient })
        } catch (error: any) {
            console.error('Error initializing clients:', error)
            throw error
        }
    }, [selectedNetwork])

    const handleNetworkChange = async (event: SelectChangeEvent) => {
        const newNetwork = event.target.value
        setSelectedNetwork(newNetwork)
        
        if (connectedAddress) {
            try {
                await window.ethereum.request({
                    method: 'wallet_switchEthereumChain',
                    params: [{ chainId: newNetwork }],
                })
                
                await initializeClients()
                setStatus(`Connected to ${NETWORKS[newNetwork].name}: ${connectedAddress}`)
                setStatusClass('success')
            } catch (error: any) {
                console.error('Network switch error:', error)
                setStatus('Failed to switch network')
                setStatusClass('error')
            }
        }
    }

    const connectWallet = async () => {
        try {
            setStatus('Connecting to MetaMask...')
            setStatusClass('info')

            if (!window.ethereum) {
                throw new Error('MetaMask not found')
            }

            try {
                await window.ethereum.request({
                    method: 'wallet_switchEthereumChain',
                    params: [{ chainId: selectedNetwork }],
                })
            } catch (switchError: any) {
                if (switchError.code === 4902) {
                    const network = NETWORKS[selectedNetwork]
                    await window.ethereum.request({
                        method: 'wallet_addEthereumChain',
                        params: [{
                            chainId: selectedNetwork,
                            chainName: network.name,
                            nativeCurrency: network.chain.nativeCurrency,
                            rpcUrls: [network.chain.rpcUrls.default.http[0]],
                            blockExplorerUrls: [network.explorerUrl],
                        }],
                    })
                } else {
                    throw switchError
                }
            }

            const [address] = await window.ethereum.request({ method: 'eth_requestAccounts' })
            setConnectedAddress(address)
            setStatus(`Connected to ${NETWORKS[selectedNetwork].name}: ${address}`)
            setStatusClass('success')
            await initializeClients()
        } catch (error: any) {
            console.error('Connection error:', error)
            setStatus(error.message)
            setStatusClass('error')
        }
    }

    const addTransaction = () => {
        const newTransaction = {
            to: '0x1230000000000000000000000000000000000123',
            value: '0.00001',
            data: '0x00'
        }
        setTransactions([...transactions, newTransaction])
    }

    const removeTransaction = (indexToRemove: number) => {
        setTransactions(transactions.filter((_, index) => index !== indexToRemove))
    }

    const updateTransaction = (index: number, field: keyof Transaction, value: string) => {
        const newTransactions = [...transactions]
        newTransactions[index] = { ...newTransactions[index], [field]: value }
        setTransactions(newTransactions)
    }

    const pollTransactionStatus = async (requestId: string): Promise<string> => {
        return new Promise((resolve, reject) => {
            const maxAttempts = 30 // 30 attempts with 2s delay = 1 minute max
            let attempts = 0

            const poll = async () => {
                try {
                    const result = await window.ethereum.request({
                        method: 'wallet_getCallsStatus',
                        params: [requestId],
                    })

                    console.log('Status check result:', result)

                    if (result.status === 200 && result.receipts?.[0]?.transactionHash) {
                        resolve(result.receipts[0].transactionHash)
                        return
                    }

                    attempts++
                    if (attempts >= maxAttempts) {
                        reject(new Error('Timeout waiting for transaction confirmation'))
                        return
                    }

                    setTimeout(poll, 2000) // Poll every 2 seconds
                } catch (error) {
                    reject(error)
                }
            }

            poll()
        })
    }

    const executeBundledTransactions = async () => {
        if (!clients) {
            setStatus('Clients not initialized')
            setStatusClass('error')
            return
        }

        setIsExecuting(true)
        setStatus('Preparing transactions...')
        setStatusClass('info')
        setTxHash('')

        try {
            if (!window.ethereum || !connectedAddress) {
                throw new Error('Please connect your wallet first')
            }

            if (transactions.length === 0) {
                throw new Error('Please add at least one transaction')
            }

            // Convert transactions to the correct format
            const calls = transactions.map(tx => ({
                to: tx.to as `0x${string}`,
                value: `0x${parseEther(tx.value).toString(16)}`,
                data: tx.data.startsWith('0x') ? tx.data : `0x${tx.data}`,
            }))

            console.log('Calls:', calls)
            // Prepare the sendCalls request
            const sendCallsRequest = {
                method: 'wallet_sendCalls',
                params: [{
                    version: '2.0.0',
                    from: connectedAddress,
                    chainId: `0x${NETWORKS[selectedNetwork].chain.id.toString(16)}`,
                    atomicRequired: true,
                    calls,
                    capabilities: {
                        ...(paymasterUrl && {
                            paymasterService: {
                                url: paymasterUrl,
                                optional: isPaymasterOptional
                            }
                        })
                    }
                }]
            }

            setStatus('Requesting MetaMask approval...')
            const requestId = (await window.ethereum.request(sendCallsRequest)).id
            console.log('Request ID:', requestId)

            setStatus('Transaction submitted! Waiting for confirmation...')
            
            // Poll for transaction status
            const txHash = await pollTransactionStatus(requestId)
            console.log('Transaction hash:', txHash)

            // Wait for transaction receipt
            const receipt = await clients.publicClient.waitForTransactionReceipt({ 
                hash: txHash as `0x${string}` 
            })

            setStatus('Transactions confirmed!')
            setStatusClass('success')
            setTxHash(receipt.transactionHash)
            console.log('Receipt:', receipt)

        } catch (error: any) {
            console.error('Execution error:', error)
            setStatus(error.message || 'Unknown error occurred')
            setStatusClass('error')
        } finally {
            setIsExecuting(false)
        }
    }

    return (
        <Box sx={{ 
            position: 'relative', 
            minHeight: '100vh',
            maxWidth: '100%',
            width: '100%',
            overflow: 'hidden',
            pb: '120px' // Add padding bottom to account for footer
        }}>
            <Container maxWidth="md" sx={{ py: 4 }}>
                <Typography variant="h4" component="h1" gutterBottom>
                    EIP-7702 Demo
                </Typography>
                
                <Paper sx={{ p: 2, mb: 3, bgcolor: '#f8f9fa' }}>
                    <Typography variant="body1" sx={{ mb: 1 }}>
                        This demo showcases how to use{' '}
                        <Link href="https://eips.ethereum.org/EIPS/eip-7702" target="_blank" rel="noopener">
                            EIP-7702
                        </Link>{' '}
                        to batch multiple transactions into a single atomic operation. The demo uses the{' '}
                        <code>wallet_sendCalls</code> and <code>wallet_getCallsStatus</code> RPC methods to execute
                        bundled transactions atomically, ensuring all transactions either succeed or fail together.
                        This provides a more efficient and secure way to execute multiple related transactions.
                    </Typography>
                </Paper>

                <Alert severity={statusClass === 'success' ? 'success' : statusClass === 'error' ? 'error' : 'info'} sx={{ my: 2 }}>
                    {status}
                </Alert>

                <Paper sx={{ p: 3, mb: 3 }}>
                    <Typography variant="h6" gutterBottom>
                        Network Selection
                    </Typography>
                    <FormControl fullWidth>
                        <InputLabel>Select Network</InputLabel>
                        <Select
                            value={selectedNetwork}
                            onChange={handleNetworkChange}
                            label="Select Network"
                        >
                            <MenuItem value="0xaa36a7">Sepolia (Chain ID: 11155111)</MenuItem>
                            <MenuItem value="0x1">Ethereum Mainnet (Chain ID: 1)</MenuItem>
                            <MenuItem value="0x64">Gnosis (Chain ID: 100)</MenuItem>
                        </Select>
                    </FormControl>
                </Paper>

                <Button
                    variant="contained"
                    onClick={connectWallet}
                    disabled={isExecuting || !!connectedAddress}
                    sx={{ mb: 3 }}
                >
                    {connectedAddress ? 'Connected' : 'Connect MetaMask'}
                </Button>

                <Paper sx={{ p: 3 }}>
                    <Typography variant="h6" gutterBottom>
                        Bundled Transactions
                    </Typography>
                    
                    <Box sx={{ mb: 3 }}>
                        {transactions.map((tx, index) => (
                            <Paper key={index} sx={{ p: 2, mb: 2, position: 'relative' }}>
                                <IconButton
                                    size="small"
                                    onClick={() => removeTransaction(index)}
                                    sx={{ position: 'absolute', top: 8, right: 8 }}
                                >
                                    <DeleteIcon />
                                </IconButton>
                                
                                <Box sx={{ mt: 2 }}>
                                    <TextField
                                        fullWidth
                                        label="To Address"
                                        value={tx.to}
                                        onChange={(e) => updateTransaction(index, 'to', e.target.value)}
                                        margin="normal"
                                    />
                                    <TextField
                                        fullWidth
                                        label="Value (ETH)"
                                        value={tx.value}
                                        onChange={(e) => updateTransaction(index, 'value', e.target.value)}
                                        margin="normal"
                                    />
                                    <TextField
                                        fullWidth
                                        label="Data"
                                        value={tx.data}
                                        onChange={(e) => updateTransaction(index, 'data', e.target.value)}
                                        margin="normal"
                                    />
                                </Box>
                            </Paper>
                        ))}
                    </Box>

                    <Button
                        variant="outlined"
                        startIcon={<AddIcon />}
                        onClick={addTransaction}
                        fullWidth
                        sx={{ mb: 3 }}
                    >
                        Add Transaction
                    </Button>

                    <Button
                        variant="contained"
                        color="primary"
                        onClick={executeBundledTransactions}
                        disabled={!connectedAddress || transactions.length === 0 || isExecuting}
                        fullWidth
                    >
                        Execute Bundled Transactions
                    </Button>
                </Paper>

                <Paper sx={{ p: 3, mt: 3 }}>
                    <Typography variant="h6" gutterBottom>
                        Paymaster Service
                    </Typography>
                    <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                        Configure the paymaster service for gasless transactions. Leave the URL empty to skip using a paymaster.
                    </Typography>
                    
                    <TextField
                        fullWidth
                        label="Paymaster URL"
                        value={paymasterUrl}
                        onChange={(e) => setPaymasterUrl(e.target.value)}
                        margin="normal"
                        placeholder="https://api.example.com/paymaster"
                    />
                    
                    <FormControlLabel
                        control={
                            <Switch
                                checked={isPaymasterOptional}
                                onChange={(e) => setIsPaymasterOptional(e.target.checked)}
                            />
                        }
                        label="Make paymaster optional"
                    />
                </Paper>

                {txHash && (
                    <Paper sx={{ p: 3, mt: 3 }}>
                        <Typography variant="h6" gutterBottom>
                            Transaction Details
                        </Typography>
                        <Link
                            href={`${NETWORKS[selectedNetwork].explorerUrl}/${txHash}`}
                            target="_blank"
                            rel="noopener noreferrer"
                        >
                            View on Explorer
                        </Link>
                    </Paper>
                )}
            </Container>

            {/* Footer */}
            <Box
                component="footer"
                sx={{
                    position: 'absolute',
                    bottom: 0,
                    left: 0,
                    right: 0,
                    width: '100%',
                    bgcolor: '#f8f9fa',
                    borderTop: '1px solid #e0e0e0',
                }}
            >
                <Box 
                    sx={{ 
                        maxWidth: 800,
                        width: '100%',
                        mx: 'auto',
                        px: 3,
                        py: 3,
                        display: 'flex',
                        flexDirection: { xs: 'column', sm: 'row' },
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        gap: 2
                    }}
                >
                    <Box>
                        <Typography variant="subtitle2" color="text.secondary" gutterBottom>
                            Resources
                        </Typography>
                        <Box sx={{ 
                            display: 'flex', 
                            gap: 2,
                            flexWrap: 'wrap'
                        }}>
                            <Link 
                                href="https://eips.ethereum.org/EIPS/eip-7702" 
                                target="_blank" 
                                rel="noopener"
                                sx={{ 
                                    color: 'primary.main',
                                    textDecoration: 'none',
                                    '&:hover': {
                                        textDecoration: 'underline'
                                    }
                                }}
                            >
                                EIP-7702
                            </Link>
                            <Link 
                                href="https://metamask.io" 
                                target="_blank" 
                                rel="noopener"
                                sx={{ 
                                    color: 'primary.main',
                                    textDecoration: 'none',
                                    '&:hover': {
                                        textDecoration: 'underline'
                                    }
                                }}
                            >
                                MetaMask
                            </Link>
                        </Box>
                    </Box>
                    <Box 
                        sx={{ 
                            display: 'flex',
                            alignItems: 'center',
                            gap: 0.5
                        }}
                    >
                        <Typography 
                            variant="body2" 
                            sx={{ 
                                color: 'text.secondary',
                                fontWeight: 500,
                                letterSpacing: 0.5
                            }}
                        >
                            © {new Date().getFullYear()}
                        </Typography>
                        <Link
                            href="https://github.com/miguelmota"
                            target="_blank"
                            rel="noopener"
                            sx={{ 
                                color: 'text.primary',
                                textDecoration: 'none',
                                fontWeight: 500,
                                '&:hover': {
                                    color: 'text.primary',
                                    textDecoration: 'underline'
                                }
                            }}
                        >
                            Miguel Mota
                        </Link>
                    </Box>
                </Box>
            </Box>
        </Box>
    )
} 