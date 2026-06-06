const getTodayRangeIST = () => {
    const now = new Date();
    const istTime = new Date(now.getTime() + (5.5 * 60 * 60 * 1000));

    const year = istTime.getUTCFullYear();
    const month = istTime.getUTCMonth();
    const date = istTime.getUTCDate();

    const istStart = new Date(Date.UTC(year, month, date, 0, 0, 0, 0));
    const todayStart = new Date(istStart.getTime() - (5.5 * 60 * 60 * 1000));

    const istEnd = new Date(Date.UTC(year, month, date, 23, 59, 59, 999));
    const todayEnd = new Date(istEnd.getTime() - (5.5 * 60 * 60 * 1000));

    return { todayStart, todayEnd };
};

console.log("Current system time:", new Date().toISOString());
const range = getTodayRangeIST();
console.log("todayStart:", range.todayStart.toISOString());
console.log("todayEnd:", range.todayEnd.toISOString());
console.log("Local todayStart:", range.todayStart.toString());
console.log("Local todayEnd:", range.todayEnd.toString());
