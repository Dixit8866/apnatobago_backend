export const addFcmToken = (existingToken, newToken) => {
    if (!newToken || typeof newToken !== 'string') return existingToken;
    const token = newToken.trim();
    if (!token) return existingToken;

    let tokens = [];
    if (existingToken) {
        const trimmed = existingToken.trim();
        if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
            try {
                tokens = JSON.parse(trimmed);
            } catch (e) {
                tokens = [trimmed];
            }
        } else {
            tokens = [trimmed];
        }
    }

    if (!Array.isArray(tokens)) {
        tokens = [];
    }

    // Filter out invalid/empty tokens, and dedup
    tokens = tokens.map(t => typeof t === 'string' ? t.trim() : '').filter(Boolean);
    
    if (!tokens.includes(token)) {
        tokens.push(token);
    }

    // Limit to max 10 tokens to prevent bloating
    if (tokens.length > 10) {
        tokens = tokens.slice(tokens.length - 10);
    }

    return JSON.stringify(tokens);
};

export const removeFcmToken = (existingToken, tokenToRemove) => {
    if (!tokenToRemove || typeof tokenToRemove !== 'string' || !existingToken) return existingToken;
    const toRemove = tokenToRemove.trim();
    if (!toRemove) return existingToken;

    let tokens = [];
    const trimmed = existingToken.trim();
    if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
        try {
            tokens = JSON.parse(trimmed);
        } catch (e) {
            tokens = [trimmed];
        }
    } else {
        tokens = [trimmed];
    }

    if (!Array.isArray(tokens)) {
        return null;
    }

    tokens = tokens.map(t => typeof t === 'string' ? t.trim() : '').filter(Boolean);
    tokens = tokens.filter(t => t !== toRemove);

    if (tokens.length === 0) return null;
    return JSON.stringify(tokens);
};
