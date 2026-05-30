const buildSystemBlocks = (staticText, dynamicText = '') => {
    const blocks = [
        {
            type: 'text',
            text: staticText,
            cache_control: { type: 'ephemeral' },
        },
    ];

    if (dynamicText && dynamicText.trim()) {
        blocks.push({
            type: 'text',
            text: dynamicText,
        });
    }

    return blocks;
};

module.exports = { buildSystemBlocks };
