import axios from 'axios';
import Vendor from '../models/superadmin-models/Vendor.js';

class AdsService {
    /**
     * Fetch all Ad Accounts associated with the vendor's connected FB account
     */
    async getAdAccounts(vendorId) {
        const vendor = await Vendor.findByPk(vendorId);
        const accessToken = vendor?.waAccessToken || process.env.WA_ACCESS_TOKEN;

        if (!vendor) throw new Error('Vendor not found');
        if (!accessToken) {
            throw new Error('Meta Ads credentials not found. Please connect via WhatsApp settings.');
        }

        try {
            console.log(`[AdsService] Fetching accounts for vendor ${vendorId} using token: ${accessToken.substring(0, 10)}... (Source: ${vendor.waAccessToken ? 'Vendor' : 'Platform Fallback'})`);
            const response = await axios.get(`https://graph.facebook.com/${process.env.META_GRAPH_VERSION || 'v19.0'}/me/adaccounts`, {
                params: {
                    fields: 'name,account_id,id,currency,timezone_name,account_status',
                    access_token: accessToken
                }
            });
            console.log(`[Meta API] Successfully fetched ${response.data.data?.length || 0} accounts.`);
            return response.data.data;
        } catch (error) {
            const apiError = error.response?.data?.error;
            console.error('[Meta API Error Detail]:', {
                message: apiError?.message,
                type: apiError?.type,
                code: apiError?.code,
                subcode: apiError?.error_subcode
            });
            throw new Error(`Meta API Error: ${apiError?.message || error.message}`);
        }
    }

    async getInsights(adAccountId, vendorId, dateRange = 'last_30d') {
        const vendor = await Vendor.findByPk(vendorId);
        const accessToken = vendor?.waAccessToken || process.env.WA_ACCESS_TOKEN;
        
        if (!accessToken) {
            throw new Error('Meta Ads credentials not found. Please connect via WhatsApp settings.');
        }

        try {
            const response = await axios.get(`https://graph.facebook.com/${process.env.META_GRAPH_VERSION || 'v19.0'}/${adAccountId}/insights`, {
                params: {
                    fields: 'spend,impressions,clicks,reach,conversions,cpc,ctr',
                    date_preset: dateRange,
                    time_increment: 1, // Daily breakdown for charts
                    access_token: accessToken
                }
            });
            
            // Format daily data for charts
            const breakdownData = response.data.data.map(item => ({
                date_start: item.date_start,
                spend: parseFloat(item.spend || 0),
                impressions: parseInt(item.impressions || 0),
                clicks: parseInt(item.clicks || 0),
                conversions: parseInt(item.conversions || 0),
                ctr: parseFloat(item.ctr || 0)
            }));

            // Summary stats
            const summaryRes = await axios.get(`https://graph.facebook.com/${process.env.META_GRAPH_VERSION || 'v19.0'}/${adAccountId}/insights`, {
                params: {
                    fields: 'spend,impressions,clicks,reach,conversions,cpc,ctr',
                    date_preset: dateRange,
                    access_token: vendor.waAccessToken
                }
            });

            return {
                summary: summaryRes.data.data[0] || {},
                breakdown: breakdownData
            };
        } catch (error) {
            console.error('Meta Insights Error:', error.response?.data || error.message);
            throw new Error('Failed to fetch Insights');
        }
    }

    /**
     * Fetch Active Campaigns
     */
    async getCampaigns(adAccountId, vendorId) {
        const vendor = await Vendor.findByPk(vendorId);
        const accessToken = vendor?.waAccessToken || process.env.WA_ACCESS_TOKEN;

        if (!accessToken) {
            throw new Error('Meta Ads credentials not found. Please connect via WhatsApp settings.');
        }
        try {
            const response = await axios.get(`https://graph.facebook.com/${process.env.META_GRAPH_VERSION || 'v19.0'}/${adAccountId}/campaigns`, {
                params: {
                    fields: 'name,status,objective,start_time,stop_time,buying_type',
                    access_token: accessToken
                }
            });
            return response.data.data;
        } catch (error) {
            console.error('Meta API Error:', error.response?.data || error.message);
            throw new Error('Failed to fetch Campaigns');
        }
    }

    /**
     * Create a complete Ad flow: Campaign -> Ad Set -> Creative -> Ad
     */
    async createAdFlow(vendorId, adAccountId, adData) {
        const vendor = await Vendor.findByPk(vendorId);
        const accessToken = vendor?.waAccessToken || process.env.WA_ACCESS_TOKEN;

        if (!accessToken) {
            throw new Error('Meta Ads credentials not found. Please connect via WhatsApp settings.');
        }
        const version = process.env.META_GRAPH_VERSION || 'v19.0';

        try {
            // 1. Create Campaign
            const campaignRes = await axios.post(`https://graph.facebook.com/${version}/${adAccountId}/campaigns`, {
                name: adData.name,
                objective: 'OUTCOME_ENGAGEMENT', // Engagement for WhatsApp messages
                status: 'PAUSED',
                special_ad_categories: 'NONE',
                access_token: accessToken
            });
            const campaignId = campaignRes.data.id;

            // 2. Create Ad Set with Advanced Targeting
            const adSetRes = await axios.post(`https://graph.facebook.com/${version}/${adAccountId}/adsets`, {
                name: `${adData.name} - AdSet`,
                campaign_id: campaignId,
                daily_budget: adData.budget * 100, 
                billing_event: 'IMPRESSIONS',
                optimization_goal: 'REPLIES', // Optimized for WhatsApp replies
                bid_strategy: 'LOWEST_COST_WITHOUT_CAP',
                promoted_object: { page_id: adData.pageId }, 
                targeting: { 
                    geo_locations: { 
                        countries: adData.locations || ['IN'] 
                    },
                    age_min: parseInt(adData.ageMin) || 18,
                    age_max: parseInt(adData.ageMax) || 65,
                    publisher_platforms: ['facebook', 'instagram', 'messenger']
                },
                status: 'PAUSED',
                access_token: accessToken
            });
            const adSetId = adSetRes.data.id;

            return { campaignId, adSetId };
        } catch (error) {
            console.error('Meta Ad Flow Error:', error.response?.data || error.message);
            throw new Error(error.response?.data?.error?.message || 'Failed to create Meta Ad Flow');
        }
    }
}

export default new AdsService();
