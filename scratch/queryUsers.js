const run = () => {
    const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: 'Asia/Kolkata',
        hour: 'numeric',
        minute: 'numeric',
        hour12: false
    });
    const formattedParts = formatter.formatToParts(new Date());
    const hoursPart = formattedParts.find(p => p.type === 'hour').value;
    const minutesPart = formattedParts.find(p => p.type === 'minute').value;
    
    const hours = parseInt(hoursPart, 10);
    const minutes = parseInt(minutesPart, 10);

    console.log({
        formattedParts,
        hoursPart,
        minutesPart,
        hours,
        minutes
    });
};
run();
