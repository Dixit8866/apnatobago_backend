/**
 * Standard HTTP Status Codes mapping
 * Used across the application to maintain consistency.
 */
const HTTP_STATUS = {
    // 2xx Success Responses
    OK: 200,                        // Standard response for successful HTTP requests
    CREATED: 201,                   // Request has been fulfilled, resulting in the creation of a new resource
    ACCEPTED: 202,                  // Request has been accepted for processing, but the processing has not been completed
    NO_CONTENT: 204,                // Server successfully processed the request and is not returning any content

    // 4xx Client Error Responses
    BAD_REQUEST: 400,               // Server cannot or will not process the request due to something that is perceived to be a client error
    UNAUTHORIZED: 401,              // Similar to 403 Forbidden, but specifically for use when authentication is required and has failed or has not yet been provided
    PAYMENT_REQUIRED: 402,          // Reserved for future use
    FORBIDDEN: 403,                 // The client does not have access rights to the content
    NOT_FOUND: 404,                 // Server can not find the requested resource
    METHOD_NOT_ALLOWED: 405,        // The request method is known by the server but is not supported by the target resource
    CONFLICT: 409,                  // Request could not be processed because of conflict in the current state of the resource
    UNPROCESSABLE_ENTITY: 422,      // The request was well-formed but was unable to be followed due to semantic errors
    TOO_MANY_REQUESTS: 429,         // The user has sent too many requests in a given amount of time ("rate limiting")

    // 5xx Server Error Responses
    INTERNAL_SERVER_ERROR: 500,     // The server has encountered a situation it does not know how to handle
    NOT_IMPLEMENTED: 501,           // The request method is not supported by the server and cannot be handled
    BAD_GATEWAY: 502,               // The server, while acting as a gateway or proxy, received an invalid response from the upstream server
    SERVICE_UNAVAILABLE: 503,       // The server is not ready to handle the request (e.g., down for maintenance or overloaded)
    GATEWAY_TIMEOUT: 504            // The server is acting as a gateway or proxy and did not receive a timely response from the upstream server
};

export default HTTP_STATUS;
