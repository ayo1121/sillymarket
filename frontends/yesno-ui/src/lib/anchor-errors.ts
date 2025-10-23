// lib/anchor-errors.ts
export const decodeAnchorError = (error: any): string => {
  if (!error) return 'Unknown error occurred';
  
  // Check for Anchor error logs
  if (error.logs && Array.isArray(error.logs)) {
    const errorLog = error.logs.find((log: string) => 
      log.includes('Error Message:') || log.includes('Program log: Error:')
    );
    
    if (errorLog) {
      // Extract the actual error message
      const message = errorLog
        .replace('Error Message: ', '')
        .replace('Program log: Error: ', '')
        .trim();
      return message || 'Anchor program error';
    }
    
    // Return all logs if no specific error message found
    return error.logs.join('\n');
  }
  
  // Check for transaction error
  if (error.message) {
    return error.message;
  }
  
  return String(error);
};

// Usage in your transaction calls:
try {
  // your transaction code
} catch (error) {
  const decodedError = decodeAnchorError(error);
  push({ 
    variant: 'error', 
    title: 'Transaction Failed', 
    message: decodedError 
  });
}
