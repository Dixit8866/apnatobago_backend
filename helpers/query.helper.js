export const getPaginationOptions = (reqQuery) => {
    // If paginate is explicitly 'false', return no pagination options
    if (reqQuery.paginate === 'false') {
        return {};
    }

    const page = parseInt(reqQuery.page, 10) || 1;
    const limit = parseInt(reqQuery.limit, 10) || 50;
    const offset = (page - 1) * limit;

    return { limit, offset, page };
};

export const formatPaginatedResponse = (data, page, limit) => {
    const currentPage = Number(page) || 1;
    const pageLimit = Number(limit) || 50;
    return {
        totalRecords: data.count,
        totalPages: Math.max(1, Math.ceil(data.count / pageLimit)),
        currentPage,
        data: data.rows
    };
};
