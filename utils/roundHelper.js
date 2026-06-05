/**
 * Custom rounding helper for grand totals.
 * If the decimal part is 0.05 or higher, round up to the next integer.
 * Otherwise, round down.
 * Example:
 * 114.05 -> 115
 * 114.03 -> 114
 */
export const roundTotal = (amount) => {
    const amt = parseFloat(amount || 0);
    const floorVal = Math.floor(amt);
    const decimal = amt - floorVal;
    if (decimal >= 0.05 - 1e-9) {
        return floorVal + 1;
    } else {
        return floorVal;
    }
};
