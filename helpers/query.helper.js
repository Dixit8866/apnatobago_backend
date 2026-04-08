export const getPaginationOptions = (reqQuery) => {
    // If paginate is explicitly 'false', return no pagination options
    if (reqQuery.paginate === 'false') {
        return {};
    }

    const page = parseInt(reqQuery.page, 10) || 1;
    const limit = parseInt(reqQuery.limit, 10) || 10;
    const offset = (page - 1) * limit;

    return { limit, offset, page };
};

export const formatPaginatedResponse = (data, page, limit) => {
    return {
        totalRecords: data.count,
        totalPages: Math.ceil(data.count / limit),
        currentPage: page,
        data: data.rows
    };
};
