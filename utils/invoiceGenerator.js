import PDFDocument from 'pdfkit-table';
import PDFKitNative from 'pdfkit';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import Product from '../models/superadmin-models/Product.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const logoPath = path.join(__dirname, '..', 'assets', 'logo.png');

const getItemBoxNumber = (item) => {
    return (
        item.product?.boxNumber ||
        item.variantInfo?.boxNumber ||
        item.variantInfo?.productBoxNumber ||
        item.variant?.product?.boxNumber ||
        item.boxNumber ||
        ''
    );
};

const getItemDisplayName = (item) => {
    const pName = item.product?.name;
    let name = '';
    if (typeof pName === 'object' && pName !== null) {
        name = pName.gu || pName.guj || pName.en || pName.EN || pName.hn || pName.HN || '';
    } else if (typeof pName === 'string') {
        name = pName;
    } else if (item.variantInfo?.productName) {
        name = item.variantInfo.productName;
    } else {
        name = 'Item';
    }
    return String(name).trim();
};

const sortItemsByBoxNumber = (items) => {
    return [...(items || [])].sort((a, b) => {
        const rawBoxA = String(getItemBoxNumber(a) || '').trim();
        const rawBoxB = String(getItemBoxNumber(b) || '').trim();

        const hasBoxA = rawBoxA !== '';
        const hasBoxB = rawBoxB !== '';

        if (hasBoxA && !hasBoxB) return -1;
        if (!hasBoxA && hasBoxB) return 1;

        if (hasBoxA && hasBoxB) {
            const matchA = rawBoxA.match(/\d+/);
            const matchB = rawBoxB.match(/\d+/);

            const numA = matchA ? parseInt(matchA[0], 10) : null;
            const numB = matchB ? parseInt(matchB[0], 10) : null;

            if (numA !== null && numB !== null) {
                if (numA !== numB) {
                    return numA - numB;
                }
            } else if (numA !== null) {
                return -1;
            } else if (numB !== null) {
                return 1;
            }

            const boxCompare = rawBoxA.localeCompare(rawBoxB, undefined, { numeric: true, sensitivity: 'base' });
            if (boxCompare !== 0) {
                return boxCompare;
            }
        }

        const nameA = getItemDisplayName(a);
        const nameB = getItemDisplayName(b);
        return nameA.localeCompare(nameB, undefined, { numeric: true, sensitivity: 'base' });
    });
};

/**
 * Generates a professional Sales Invoice PDF (A4 Compact Style)
 * @param {Object} order - Order object with items and user details
 * @returns {Promise<Buffer>} - PDF Buffer
 */
export const generateOrderInvoice = async (order) => {
    return new Promise((resolve, reject) => {
        try {
            const doc = new PDFKitNative({ 
                size: 'A4',
                margin: 25,
                autoFirstPage: true
            });
            
            const buffers = [];
            doc.on('data', (chunk) => buffers.push(chunk));
            doc.on('end', () => resolve(Buffer.concat(buffers)));
            doc.on('error', (err) => reject(err));

            const width = doc.page.width - 50;

            // ── Header Area ──────────────────────────────────────────────────
            if (fs.existsSync(logoPath)) {
                doc.image(logoPath, 25, 20, { height: 35 });
            } else {
                doc.fillColor('#000000').fontSize(14).font('Helvetica-Bold').text('APNA TOBACCO', 25, 20);
            }
            
            doc.fillColor('#64748b').fontSize(7).font('Helvetica').text('TAX INVOICE / SALES BILL', 25, 60);

            doc.fillColor('#000000').fontSize(8).font('Helvetica-Bold')
               .text('INVOICE NO:', 0, 25, { align: 'right', width: doc.page.width - 25 })
               .fontSize(12).text(order.orderId, 0, 35, { align: 'right', width: doc.page.width - 25 });
            
            doc.lineWidth(0.3).strokeColor('#cbd5e1').moveTo(25, 75).lineTo(doc.page.width - 25, 75).stroke();

            // ── Details Grid ──────────────────────────────────────────────────
            const startY = 85;

            // Invoice Meta
            const metaX = doc.page.width - 160;
            doc.rect(metaX - 5, startY, 140, 75).lineWidth(0.3).strokeColor('#cbd5e1').stroke();
            
            doc.fontSize(7).font('Helvetica-Bold').fillColor('#64748b').text('DATE:', metaX, startY + 8);
            doc.fontSize(9).fillColor('#000000').text(new Date(order.createdAt).toLocaleDateString('en-IN'), metaX + 50, startY + 8);
            
            doc.fontSize(7).font('Helvetica-Bold').fillColor('#64748b').text('PAYMENT:', metaX, startY + 23);
            doc.fontSize(9).fillColor('#000000').font('Helvetica-Bold').text(order.paymentMethod || 'COD', metaX + 50, startY + 23);

            doc.fillColor('#64748b').fontSize(7).font('Helvetica-Bold').text('STATUS:', metaX, startY + 38);
            doc.fillColor('#000000').fontSize(9).text(order.orderStatus || '-', metaX + 50, startY + 38);

            // ── Table ─────────────────────────────────────────────────────────
            const tableY = startY + 95;
            doc.fillColor('#000000').rect(25, tableY, width, 18).fill();
            doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(7);
            doc.text('SR.', 30, tableY + 6);
            doc.text('ITEM DESCRIPTION', 60, tableY + 6);
            doc.text('PRICE', doc.page.width - 180, tableY + 6, { width: 50, align: 'right' });
            doc.text('QTY', doc.page.width - 120, tableY + 6, { width: 30, align: 'center' });
            doc.text('TOTAL', doc.page.width - 85, tableY + 6, { width: 60, align: 'right' });

            let itemY = tableY + 22;
            const items = sortItemsByBoxNumber(order.items || []);
            let subtotal = 0;
            
            items.forEach((it, idx) => {
                if (itemY > doc.page.height - 150) return;

                if (idx % 2 === 1) {
                    doc.fillColor('#f8fafc').rect(25, itemY - 3, width, 14).fill();
                }
                
                doc.fillColor('#334155').font('Helvetica-Bold').fontSize(7);
                doc.text(`${idx + 1}.`, 30, itemY);
                
                const pName = it.product?.name || it.variantInfo?.productName;
                let nameStr = 'Product';
                if (pName) {
                    if (typeof pName === 'object') {
                        nameStr = pName.en || pName.EN || pName.eng || pName.ENG || pName.gu || pName.GU || pName.guj || pName.GUJ || Object.values(pName)[0] || 'Product';
                    } else {
                        nameStr = String(pName);
                    }
                }
                const volume = it.variant?.volume || it.variantInfo?.volume || '';
                let volStr = '';
                if (volume) {
                    if (typeof volume === 'object') {
                        volStr = volume.en || volume.EN || volume.eng || volume.ENG || volume.gu || volume.GU || volume.guj || volume.GUJ || Object.values(volume)[0] || '';
                    } else {
                        volStr = String(volume);
                    }
                }
                
                // Determine unit label (pcs vs carton)
                const sellUnit = it.sellUnit || 'Base';
                const vInfo = it.variantInfo || {};
                const baseUnitId = it.variant?.baseUnitLabel || vInfo.baseUnitLabel;
                const isDando = baseUnitId === '3451fa71-7dbc-4a25-aae0-5f6fce472cc6' || String(baseUnitId).toLowerCase() === 'dando' || String(baseUnitId) === 'ડંડો';

                let displayQuantity = Number(it.quantity);
                let displayPrice = Number(it.price);
                let rawLabel = '';

                const mainCategoryId = it.product?.mainCategoryId || it.product?.mainCategory?.id || '';
                const isCigaretteCategory = mainCategoryId === '47b5d282-9cd2-4656-a695-8c237b4b2bfb';

                if (isDando || isCigaretteCategory) {
                    volStr = '';
                }

                if (isDando && sellUnit !== 'Inner') {
                    const dbUPP = Number(it.variant?.baseUnitsPerPack || vInfo.baseUnitsPerPack || 0);
                    const bUPP = (dbUPP && dbUPP !== 1) ? dbUPP : 20;
                    const sVol = Number(it.variant?.sellingVolume || vInfo.sellingVolume || 1);
                    const multiplier = bUPP * sVol;

                    displayQuantity = displayQuantity * multiplier;
                    displayPrice = displayPrice / multiplier;
                    rawLabel = vInfo.innerUnitLabel || 'Box';
                } else {
                    rawLabel = sellUnit === 'Inner' ? (vInfo.innerUnitLabel || 'Pcs') : (vInfo.baseUnitLabel || 'Carton');
                }

                let unitLabel = '';
                if (typeof rawLabel === 'object') {
                    unitLabel = rawLabel.en || rawLabel.EN || rawLabel.eng || rawLabel.ENG || rawLabel.gu || rawLabel.GU || rawLabel.guj || rawLabel.GUJ || Object.values(rawLabel)[0] || '';
                } else {
                    unitLabel = String(rawLabel);
                }
                
                const displayName = volStr ? `(${volStr}) ${nameStr}` : nameStr;
                doc.font('Helvetica').text(displayName, 60, itemY, { width: width - 250 });
                doc.text(`₹${Number(displayPrice).toFixed(2)}`, doc.page.width - 180, itemY, { width: 50, align: 'right' });
                doc.text(`${displayQuantity} ${unitLabel}`, doc.page.width - 120, itemY, { width: 45, align: 'center' });
                doc.font('Helvetica-Bold').text(`₹${(it.price * it.quantity).toFixed(2)}`, doc.page.width - 85, itemY, { width: 60, align: 'right' });
                
                subtotal += it.price * it.quantity;
                itemY += 14;
            });

            let totalReturnedAmount = 0;
            const returns = order.returns || [];

            if (returns.length > 0) {
                itemY += 10;
                doc.fillColor('#e11d48').font('Helvetica-Bold').fontSize(8).text('RETURNED / REFUNDED ITEMS (વેચાણ પરત વસ્તુઓ)', 25, itemY);
                itemY += 12;

                returns.forEach((ret, idx) => {
                    if (itemY > doc.page.height - 150) return;

                    doc.fillColor('#fff1f2').rect(25, itemY - 3, width, 14).fill();

                    doc.fillColor('#e11d48').font('Helvetica-Bold').fontSize(7);
                    doc.text(`${idx + 1}.`, 30, itemY);

                    const pName = ret.product?.name;
                    let nameStr = 'Product';
                    if (pName) {
                        if (typeof pName === 'object') {
                            nameStr = pName.en || pName.EN || pName.eng || pName.ENG || pName.gu || pName.GU || pName.guj || pName.GUJ || Object.values(pName)[0] || 'Product';
                        } else {
                            nameStr = String(pName);
                        }
                    }
                    const volume = ret.variant?.volume || '';
                    let volStr = '';
                    if (volume) {
                        if (typeof volume === 'object') {
                            volStr = volume.en || volume.EN || volume.eng || volume.ENG || volume.gu || volume.GU || volume.guj || volume.GUJ || Object.values(volume)[0] || '';
                        } else {
                            volStr = String(volume);
                        }
                    }
                    const mainCategoryId = ret.product?.mainCategoryId || ret.product?.mainCategory?.id || '';
                    const isCigaretteCategory = mainCategoryId === '47b5d282-9cd2-4656-a695-8c237b4b2bfb';
                    if (isCigaretteCategory) {
                        volStr = '';
                    }

                    const isInner = (ret.reason || '').startsWith('[Inner]');
                    const unitLabel = isInner ? 'Pcs' : 'Pack';

                    doc.font('Helvetica').text(`${nameStr} (${volStr})`, 60, itemY, { width: width - 250 });
                    doc.text(`₹${Number(ret.price).toFixed(2)}`, doc.page.width - 180, itemY, { width: 50, align: 'right' });
                    doc.text(`-${ret.quantity} ${unitLabel}`, doc.page.width - 120, itemY, { width: 45, align: 'center' });
                    doc.font('Helvetica-Bold').text(`-₹${Number(ret.returnAmount).toFixed(2)}`, doc.page.width - 85, itemY, { width: 60, align: 'right' });

                    totalReturnedAmount += Number(ret.returnAmount);
                    itemY += 14;
                });
            }

            // ── Totals ────────────────────────────────────────────────────────
            const totalY = itemY + 10;
            doc.lineWidth(0.3).strokeColor('#cbd5e1').moveTo(doc.page.width - 180, totalY).lineTo(doc.page.width - 25, totalY).stroke();
            
            let currentTotalY = totalY + 8;
            if (totalReturnedAmount > 0) {
                const originalSubtotal = subtotal + totalReturnedAmount;
                doc.fillColor('#64748b').fontSize(7).font('Helvetica-Bold').text('ORIGINAL SUB: ', doc.page.width - 180, currentTotalY);
                doc.fillColor('#334155').fontSize(8).font('Helvetica').text(`₹${originalSubtotal.toFixed(2)}`, doc.page.width - 85, currentTotalY - 1, { width: 60, align: 'right' });
                currentTotalY += 11;

                doc.fillColor('#64748b').fontSize(7).font('Helvetica-Bold').text('LESS RETURNS: ', doc.page.width - 180, currentTotalY);
                doc.fillColor('#e11d48').fontSize(8).font('Helvetica-Bold').text(`-₹${totalReturnedAmount.toFixed(2)}`, doc.page.width - 85, currentTotalY - 1, { width: 60, align: 'right' });
                currentTotalY += 11;
            }

            const deliveryCharge = parseFloat(order.deliveryCharge) || 0;
            if (deliveryCharge > 0) {
                doc.fillColor('#64748b').fontSize(7).font('Helvetica-Bold').text('DELIVERY CHARGE: ', doc.page.width - 180, currentTotalY);
                doc.fillColor('#334155').fontSize(8).font('Helvetica').text(`₹${deliveryCharge.toFixed(2)}`, doc.page.width - 85, currentTotalY - 1, { width: 60, align: 'right' });
                currentTotalY += 11;
            }

            doc.lineWidth(0.3).strokeColor('#cbd5e1').moveTo(doc.page.width - 180, currentTotalY).lineTo(doc.page.width - 25, currentTotalY).stroke();
            currentTotalY += 5;

            doc.fillColor('#64748b').fontSize(8).font('Helvetica-Bold').text('GRAND TOTAL:', doc.page.width - 180, currentTotalY + 2);
            doc.fillColor('#0d9488').fontSize(12).font('Helvetica-Bold').text(`₹${Number(order.totalAmount).toFixed(2)}`, doc.page.width - 85, currentTotalY, { width: 60, align: 'right' });

            // Calculate cartoon/carton count robustly
            let cartonCount = 0;
            items.forEach(it => {
                const volId = it.variant?.volumeId || it.variantInfo?.volumeId;
                const vol = it.variant?.volume || it.variantInfo?.volume || '';
                let volStr = '';
                if (vol) {
                    volStr = typeof vol === 'object' ? (vol.en || vol.gu || vol.HN || '') : String(vol);
                }
                const isCartoon = (
                    volId === '83c46539-acaa-45a0-bf29-b4acaa315f08' || 
                    volId === '5cc1c1a1-3789-4823-9e25-227b3f101c5f' || 
                    volStr.toLowerCase().includes('cartoon') || 
                    volStr.includes('કાર્ટૂન') || 
                    volStr.includes('કાર્ટુન')
                );
                if (isCartoon) {
                    cartonCount += Number(it.quantity || 0);
                }
            });

            if (cartonCount > 0) {
                currentTotalY += 16;
                doc.fillColor('#64748b').fontSize(8).font('Helvetica-Bold').text('CARTOON:', doc.page.width - 180, currentTotalY + 2);
                doc.fillColor('#000000').fontSize(10).font('Helvetica-Bold').text(`${cartonCount}`, doc.page.width - 85, currentTotalY, { width: 60, align: 'right' });
            }

            // ── Footer ────────────────────────────────────────────────────────
            const footerY = doc.page.height - 100;
            doc.lineWidth(0.3).strokeColor('#cbd5e1').moveTo(25, footerY).lineTo(doc.page.width - 25, footerY).stroke();
            
            doc.fillColor('#334155').font('Helvetica-Bold').fontSize(7).text('TERMS & CONDITIONS:', 25, footerY + 10);
            doc.font('Helvetica').fontSize(6).text('1. Goods once sold will not be taken back.\n2. Subject to Surat jurisdiction.', 25, footerY + 18);

            doc.fillColor('#000000').fontSize(8).font('Helvetica-Bold').text('AUTHORIZED SIGNATORY', 0, footerY + 30, { align: 'right', width: doc.page.width - 25 });
            doc.text('____________________', 0, footerY + 45, { align: 'right', width: doc.page.width - 25 });

            doc.fontSize(6).fillColor('#94a3b8').text('Computer Generated Invoice | Apna Tobacco', 0, doc.page.height - 40, { align: 'center', width: doc.page.width });

            doc.end();
        } catch (err) {
            reject(err);
        }
    });
};

/**
 * Generates a professional Purchase Bill PDF (A4 Compact Style)
 * @param {Object} bill - Purchase Bill object with items and vendor details
 * @returns {Promise<Buffer>} - PDF Buffer
 */
export const generatePurchaseBill = async (bill) => {
    // Resolve full product names if productName is truncated or missing
    const rawItems = bill.items || [];
    const prodIdsToFetch = rawItems
        .filter(it => it.productId && (!it.productName || String(it.productName).trim().length <= 5 || !String(it.productName).includes(' ')))
        .map(it => it.productId);
    
    let prodMap = new Map();
    if (prodIdsToFetch.length > 0) {
        try {
            const fetchedProds = await Product.findAll({
                where: { id: prodIdsToFetch },
                attributes: ['id', 'name']
            });
            prodMap = new Map(fetchedProds.map(p => [p.id, p]));
        } catch (e) {
            console.error("Failed to prefetch products in generatePurchaseBill:", e);
        }
    }

    return new Promise((resolve, reject) => {
        try {
            const doc = new PDFKitNative({ 
                size: 'A4',
                margin: 25,
                autoFirstPage: true
            });
            
            const buffers = [];
            doc.on('data', (chunk) => buffers.push(chunk));
            doc.on('end', () => resolve(Buffer.concat(buffers)));
            doc.on('error', (err) => reject(err));

            const pageWidth = doc.page.width; // 595.28
            const pageHeight = doc.page.height; // 841.89
            const margin = 25;
            const contentWidth = pageWidth - (margin * 2); // 545.28

            const primaryColor = '#0f2922'; // Dark Forest Green
            const goldColor = '#c5a059'; // Gold Accent Line
            const borderColor = '#d8d2c8';
            const bgWarm = '#faf9f5';
            const altRowBg = '#f7f6f2';

            let currentY = 25;

            // ── Top Header ──────────────────────────────────────────────────
            if (fs.existsSync(logoPath)) {
                doc.image(logoPath, margin, currentY, { height: 42 });
            } else {
                doc.fillColor(primaryColor).fontSize(20).font('Helvetica-Bold').text('apna TOBACCO', margin, currentY);
                doc.fillColor('#b58c3a').fontSize(8).font('Helvetica-Bold').text('Wholesale Hub', margin, currentY + 22);
            }

            // Right Header Title
            doc.fillColor(primaryColor).fontSize(20).font('Helvetica-Bold').text('PURCHASE INVOICE', margin, currentY, { align: 'right', width: contentWidth });
            doc.fillColor('#555555').fontSize(9).font('Helvetica').text('INWARD / PURCHASE BILL', margin, currentY + 24, { align: 'right', width: contentWidth });
            
            // Gold Line under header right
            doc.strokeColor(goldColor).lineWidth(2).moveTo(pageWidth - margin - 100, currentY + 38).lineTo(pageWidth - margin, currentY + 38).stroke();

            currentY += 55;

            // ── 3 Info Cards Row ────────────────────────────────────────────
            const cardHeight = 75;
            const gap = 10;
            const card1Width = 175;
            const card2Width = 145;
            const card3Width = contentWidth - card1Width - card2Width - (gap * 2); // 205.28

            // Card 1: Purchased From (Vendor)
            const c1X = margin;
            doc.rect(c1X, currentY, card1Width, 18).fill(primaryColor);
            doc.fillColor('#ffffff').fontSize(7).font('Helvetica-Bold').text('PURCHASED FROM (VENDOR)', c1X + 8, currentY + 5);
            
            doc.rect(c1X, currentY + 18, card1Width, cardHeight - 18).fillAndStroke(bgWarm, borderColor);
            const companyName = bill.vendor?.companyName ? String(bill.vendor.companyName).trim() : '';
            const vendorContactName = bill.vendor?.name ? String(bill.vendor.name).trim() : '';
            const displayName = companyName || vendorContactName || 'VENDOR';
            
            doc.fillColor(primaryColor).fontSize(10).font('Helvetica-Bold').text(displayName.toUpperCase(), c1X + 8, currentY + 23, { width: card1Width - 16, ellipsis: true });
            
            if (companyName && vendorContactName && companyName.toLowerCase() !== vendorContactName.toLowerCase()) {
                doc.fillColor('#555555').fontSize(7.5).font('Helvetica-Bold').text(`(${vendorContactName})`, c1X + 8, currentY + 34, { width: card1Width - 16, ellipsis: true });
            }
            
            doc.fillColor('#777777').fontSize(6.5).font('Helvetica-Bold').text('VENDOR CONTACT:', c1X + 8, currentY + 45);
            const phoneStr = bill.vendor?.phoneNumber || bill.vendor?.whatsappNumber || '-';
            doc.fillColor('#333333').fontSize(7.5).font('Helvetica').text(`Tel: ${phoneStr}`, c1X + 8, currentY + 54);

            // Card 2: Received At
            const c2X = c1X + card1Width + gap;
            doc.rect(c2X, currentY, card2Width, 18).fill(primaryColor);
            doc.fillColor('#ffffff').fontSize(7).font('Helvetica-Bold').text('RECEIVED AT', c2X + 8, currentY + 5);
            
            doc.rect(c2X, currentY + 18, card2Width, cardHeight - 18).fillAndStroke(bgWarm, borderColor);
            const godownName = String(bill.godown?.name || 'Master Godown');
            doc.fillColor(primaryColor).fontSize(11).font('Helvetica-Bold').text(godownName, c2X + 8, currentY + 34, { width: card2Width - 16 });

            // Card 3: Metadata Grid Table
            const c3X = c2X + card2Width + gap;
            doc.rect(c3X, currentY, card3Width, cardHeight).strokeColor(borderColor).lineWidth(0.5).stroke();
            
            const metaRows = [
                { label: 'BILL NO.', val: bill.billNo || '-' },
                { label: 'BILL DATE', val: new Date(bill.receivedDate || Date.now()).toLocaleDateString('en-IN', { day: '2-digit', month: '2-digit', year: 'numeric' }) },
                { label: 'ORDER REF', val: bill.vendorOrder?.orderNo || '-' },
                { label: 'RECEIVED BY', val: bill.receiver?.name || 'Super Admin' }
            ];

            metaRows.forEach((r, idx) => {
                const rY = currentY + (idx * (cardHeight / 4));
                if (idx > 0) {
                    doc.strokeColor(borderColor).lineWidth(0.5).moveTo(c3X, rY).lineTo(c3X + card3Width, rY).stroke();
                }
                doc.rect(c3X, rY, 75, cardHeight / 4).fill('#faf8f5');
                doc.fillColor('#555555').fontSize(6.5).font('Helvetica-Bold').text(r.label, c3X + 6, rY + 5);
                doc.fillColor(primaryColor).fontSize(8).font('Helvetica-Bold').text(r.val, c3X + 82, rY + 4, { width: card3Width - 85, ellipsis: true });
            });

            currentY += cardHeight + 15;

            // ── Products Table ──────────────────────────────────────────────
            const thHeight = 20;
            doc.rect(margin, currentY, contentWidth, thHeight).fill(primaryColor);
            
            // Columns: SR (30), DESCRIPTION (220), PACKING (100), PRICE (65), QTY (40), TOTAL (90)
            doc.fillColor('#ffffff').fontSize(7.5).font('Helvetica-Bold');
            doc.text('SR.', margin + 5, currentY + 6, { width: 25, align: 'center' });
            doc.text('PRODUCT DESCRIPTION', margin + 35, currentY + 6, { width: 210 });
            doc.text('PACKING', margin + 250, currentY + 6, { width: 95, align: 'center' });
            doc.text('P. PRICE (Rs.)', margin + 350, currentY + 6, { width: 60, align: 'right' });
            doc.text('QTY', margin + 415, currentY + 6, { width: 35, align: 'center' });
            doc.text('TOTAL (Rs.)', margin + 455, currentY + 6, { width: 85, align: 'right' });

            currentY += thHeight;

            const items = rawItems.map(it => {
                let name = typeof it.productName === 'object'
                    ? (it.productName?.en || it.productName?.gu || Object.values(it.productName || {})[0])
                    : String(it.productName || '');
                
                const dbProd = prodMap.get(it.productId);
                if (dbProd && dbProd.name) {
                    const full = dbProd.name?.en || dbProd.name?.gu || Object.values(dbProd.name || {})[0];
                    if (full) name = full;
                }
                return {
                    ...it,
                    productName: name || 'Product'
                };
            });

            items.forEach((it, idx) => {
                const hasBatch = Boolean(it.batchNumber);
                const curRowHeight = hasBatch ? 28 : 22;

                // Page overflow check
                if (currentY + curRowHeight > pageHeight - 80) {
                    doc.addPage();
                    currentY = 25;
                    // re-draw table header
                    doc.rect(margin, currentY, contentWidth, thHeight).fill(primaryColor);
                    doc.fillColor('#ffffff').fontSize(7.5).font('Helvetica-Bold');
                    doc.text('SR.', margin + 5, currentY + 6, { width: 25, align: 'center' });
                    doc.text('PRODUCT DESCRIPTION', margin + 35, currentY + 6, { width: 210 });
                    doc.text('PACKING', margin + 250, currentY + 6, { width: 95, align: 'center' });
                    doc.text('P. PRICE (Rs.)', margin + 350, currentY + 6, { width: 60, align: 'right' });
                    doc.text('QTY', margin + 415, currentY + 6, { width: 35, align: 'center' });
                    doc.text('TOTAL (Rs.)', margin + 455, currentY + 6, { width: 85, align: 'right' });
                    currentY += thHeight;
                }

                const isEven = idx % 2 === 0;
                doc.rect(margin, currentY, contentWidth, curRowHeight).fillAndStroke(isEven ? '#ffffff' : altRowBg, '#e5e2da');

                doc.fillColor('#333333').fontSize(8).font('Helvetica');
                doc.text(String(idx + 1), margin + 5, currentY + (hasBatch ? 8 : 6), { width: 25, align: 'center' });
                
                const pName = typeof it.productName === 'object' 
                    ? (it.productName?.en || it.productName?.gu || 'Product') 
                    : String(it.productName || 'Product');
                
                doc.fillColor(primaryColor).font('Helvetica-Bold').fontSize(8).text(pName, margin + 35, currentY + 4, { width: 210, ellipsis: true });
                
                if (hasBatch) {
                    let expStr = '';
                    if (it.expiryDate) {
                        expStr = ` (Exp: ${new Date(it.expiryDate).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })})`;
                    }
                    doc.fillColor('#b45309').font('Helvetica-Bold').fontSize(6.5).text(`Batch: ${it.batchNumber}${expStr}`, margin + 35, currentY + 15, { width: 210, ellipsis: true });
                }

                const packingStr = String(it.volume || '15 Unit/Carton');
                doc.fillColor('#555555').font('Helvetica').fontSize(8).text(packingStr, margin + 250, currentY + (hasBatch ? 8 : 6), { width: 95, align: 'center', ellipsis: true });
                
                const pPrice = Number(it.purchasePrice || 0).toFixed(2);
                doc.text(pPrice, margin + 350, currentY + (hasBatch ? 8 : 6), { width: 60, align: 'right' });
                
                const qtyVal = String(it.receivedQty !== undefined ? it.receivedQty : it.qty);
                doc.fillColor(primaryColor).font('Helvetica-Bold').fontSize(8).text(qtyVal, margin + 415, currentY + (hasBatch ? 8 : 6), { width: 35, align: 'center' });
                
                const totalVal = (Number(it.purchasePrice || 0) * Number(it.qty || 0)).toFixed(2);
                doc.text(totalVal, margin + 455, currentY + (hasBatch ? 8 : 6), { width: 85, align: 'right' });

                currentY += curRowHeight;
            });

            currentY += 10;

            // ── Total Bill Value Box ────────────────────────────────────────
            const totalBoxHeight = 30;
            doc.rect(margin, currentY, contentWidth, totalBoxHeight).fillAndStroke('#ffffff', borderColor);
            doc.fillColor(primaryColor).fontSize(11).font('Helvetica-Bold').text('TOTAL BILL VALUE', margin + 15, currentY + 9);

            const totalDarkWidth = 180;
            doc.rect(pageWidth - margin - totalDarkWidth, currentY, totalDarkWidth, totalBoxHeight).fill(primaryColor);
            
            const formattedTotal = `Rs. ${Number(bill.totalAmount || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
            doc.fillColor('#ffffff').fontSize(15).font('Helvetica-Bold').text(formattedTotal, pageWidth - margin - totalDarkWidth, currentY + 8, { width: totalDarkWidth - 15, align: 'right' });

            currentY += totalBoxHeight + 15;

            // ── Footer / Signature ──────────────────────────────────────────
            const footerBoxHeight = 45;
            doc.rect(margin, currentY, contentWidth, footerBoxHeight).fillAndStroke('#ffffff', borderColor);

            if (bill.note) {
                doc.fillColor('#555555').fontSize(7.5).font('Helvetica-Oblique').text(`Remarks: ${bill.note}`, margin + 10, currentY + 10, { width: 300 });
            }
            doc.fillColor('#888888').fontSize(6.5).font('Helvetica').text('Computer Generated Purchase Bill | Apna Tobacco', margin + 10, currentY + 28);

            doc.fillColor(primaryColor).fontSize(7.5).font('Helvetica-Bold').text('RECEIVER SIGNATURE', pageWidth - margin - 180, currentY + 10, { width: 170, align: 'right' });
            doc.strokeColor('#888888').lineWidth(1).moveTo(pageWidth - margin - 150, currentY + 34).lineTo(pageWidth - margin - 10, currentY + 34).stroke();

            doc.end();
        } catch (err) {
            reject(err);
        }
    });
};

/**
 * Generates a professional Vendor Order Invoice PDF (A4 Format matching Image 1)
 * @param {Object} order - Vendor Order object with items and vendor details
 * @returns {Promise<Buffer>} - PDF Buffer
 */
export const generateVendorOrderInvoice = async (order) => {
    // Resolve full product names if productName is truncated or missing
    const rawItems = order.items || [];
    const prodIdsToFetch = rawItems
        .filter(it => it.productId && (!it.productName || String(it.productName).trim().length <= 5 || !String(it.productName).includes(' ')))
        .map(it => it.productId);
    
    let prodMap = new Map();
    if (prodIdsToFetch.length > 0) {
        try {
            const fetchedProds = await Product.findAll({
                where: { id: prodIdsToFetch },
                attributes: ['id', 'name']
            });
            prodMap = new Map(fetchedProds.map(p => [p.id, p]));
        } catch (e) {
            console.error("Failed to prefetch products in generateVendorOrderInvoice:", e);
        }
    }

    return new Promise((resolve, reject) => {
        try {
            const doc = new PDFKitNative({ 
                size: 'A4',
                margin: 25,
                autoFirstPage: true
            });
            
            const buffers = [];
            doc.on('data', (chunk) => buffers.push(chunk));
            doc.on('end', () => resolve(Buffer.concat(buffers)));
            doc.on('error', (err) => reject(err));

            const pageWidth = doc.page.width; // 595.28
            const pageHeight = doc.page.height; // 841.89
            const margin = 25;
            const contentWidth = pageWidth - (margin * 2); // 545.28

            const primaryColor = '#0f2922'; // Dark Forest Green
            const goldColor = '#c5a059'; // Gold Accent Line
            const borderColor = '#d8d2c8';
            const bgWarm = '#faf9f5';
            const altRowBg = '#f7f6f2';

            let currentY = 25;

            // ── Top Header ──────────────────────────────────────────────────
            if (fs.existsSync(logoPath)) {
                doc.image(logoPath, margin, currentY, { height: 42 });
            } else {
                doc.fillColor(primaryColor).fontSize(20).font('Helvetica-Bold').text('apna TOBACCO', margin, currentY);
                doc.fillColor('#b58c3a').fontSize(8).font('Helvetica-Bold').text('Wholesale Hub', margin, currentY + 22);
            }

            // Right Header Title
            doc.fillColor(primaryColor).fontSize(20).font('Helvetica-Bold').text('VENDOR ORDER INVOICE', margin, currentY, { align: 'right', width: contentWidth });
            doc.fillColor('#555555').fontSize(9).font('Helvetica').text('OUTWARD / VENDOR ORDER', margin, currentY + 24, { align: 'right', width: contentWidth });
            
            // Gold Line under header right
            doc.strokeColor(goldColor).lineWidth(2).moveTo(pageWidth - margin - 120, currentY + 38).lineTo(pageWidth - margin, currentY + 38).stroke();

            currentY += 55;

            // ── 3 Info Cards Row ────────────────────────────────────────────
            const cardHeight = 75;
            const gap = 10;
            const card1Width = 175;
            const card2Width = 145;
            const card3Width = contentWidth - card1Width - card2Width - (gap * 2); // 205.28

            // Card 1: Purchased From / Order To (Vendor)
            const c1X = margin;
            doc.rect(c1X, currentY, card1Width, 18).fill(primaryColor);
            doc.fillColor('#ffffff').fontSize(7).font('Helvetica-Bold').text('ORDER TO (VENDOR)', c1X + 8, currentY + 5);
            
            doc.rect(c1X, currentY + 18, card1Width, cardHeight - 18).fillAndStroke(bgWarm, borderColor);
            const companyName = order.vendor?.companyName ? String(order.vendor.companyName).trim() : '';
            const vendorContactName = order.vendor?.name ? String(order.vendor.name).trim() : '';
            const displayName = companyName || vendorContactName || 'VENDOR';

            doc.fillColor(primaryColor).fontSize(10).font('Helvetica-Bold').text(displayName.toUpperCase(), c1X + 8, currentY + 23, { width: card1Width - 16, ellipsis: true });
            
            if (companyName && vendorContactName && companyName.toLowerCase() !== vendorContactName.toLowerCase()) {
                doc.fillColor('#555555').fontSize(7.5).font('Helvetica-Bold').text(`(${vendorContactName})`, c1X + 8, currentY + 34, { width: card1Width - 16, ellipsis: true });
            }
            
            doc.fillColor('#777777').fontSize(6.5).font('Helvetica-Bold').text('VENDOR CONTACT:', c1X + 8, currentY + 45);
            const phoneStr = order.vendor?.phoneNumber || order.vendor?.whatsappNumber || '-';
            doc.fillColor('#333333').fontSize(7.5).font('Helvetica').text(`Tel: ${phoneStr}`, c1X + 8, currentY + 54);

            // Card 2: Destination Godown
            const c2X = c1X + card1Width + gap;
            doc.rect(c2X, currentY, card2Width, 18).fill(primaryColor);
            doc.fillColor('#ffffff').fontSize(7).font('Helvetica-Bold').text('DELIVERY DESTINATION', c2X + 8, currentY + 5);
            
            doc.rect(c2X, currentY + 18, card2Width, cardHeight - 18).fillAndStroke(bgWarm, borderColor);
            const godownName = String(order.godown?.name || 'Master Godown');
            doc.fillColor(primaryColor).fontSize(11).font('Helvetica-Bold').text(godownName, c2X + 8, currentY + 34, { width: card2Width - 16 });

            // Card 3: Metadata Grid Table
            const c3X = c2X + card2Width + gap;
            doc.rect(c3X, currentY, card3Width, cardHeight).strokeColor(borderColor).lineWidth(0.5).stroke();
            
            const orderDateStr = new Date(order.createdAt || Date.now()).toLocaleDateString('en-IN', { day: '2-digit', month: '2-digit', year: 'numeric' });
            const deliveryDateStr = order.receivedOrderDate 
                ? new Date(order.receivedOrderDate).toLocaleDateString('en-IN', { day: '2-digit', month: '2-digit', year: 'numeric' })
                : '-';

            const metaRows = [
                { label: 'ORDER NO.', val: order.orderNo || '-' },
                { label: 'ORDER DATE', val: orderDateStr },
                { label: 'DELIVERY DATE', val: deliveryDateStr },
                { label: 'ORDER BY', val: order.createdBy?.name || order.creator?.name || 'Super Admin' }
            ];

            metaRows.forEach((r, idx) => {
                const rY = currentY + (idx * (cardHeight / 4));
                if (idx > 0) {
                    doc.strokeColor(borderColor).lineWidth(0.5).moveTo(c3X, rY).lineTo(c3X + card3Width, rY).stroke();
                }
                doc.rect(c3X, rY, 78, cardHeight / 4).fill('#faf8f5');
                doc.fillColor('#555555').fontSize(6.5).font('Helvetica-Bold').text(r.label, c3X + 6, rY + 5);
                doc.fillColor(primaryColor).fontSize(8).font('Helvetica-Bold').text(r.val, c3X + 85, rY + 4, { width: card3Width - 88, ellipsis: true });
            });

            currentY += cardHeight + 15;

            // ── Products Table ──────────────────────────────────────────────
            const thHeight = 20;
            doc.rect(margin, currentY, contentWidth, thHeight).fill(primaryColor);
            
            // Columns: SR (30), DESCRIPTION (220), PACKING (100), PRICE (65), QTY (40), TOTAL (90)
            doc.fillColor('#ffffff').fontSize(7.5).font('Helvetica-Bold');
            doc.text('SR.', margin + 5, currentY + 6, { width: 25, align: 'center' });
            doc.text('PRODUCT DESCRIPTION', margin + 35, currentY + 6, { width: 210 });
            doc.text('PACKING', margin + 250, currentY + 6, { width: 95, align: 'center' });
            doc.text('PRICE (Rs.)', margin + 350, currentY + 6, { width: 60, align: 'right' });
            doc.text('QTY', margin + 415, currentY + 6, { width: 35, align: 'center' });
            doc.text('TOTAL (Rs.)', margin + 455, currentY + 6, { width: 85, align: 'right' });

            currentY += thHeight;

            const items = rawItems.map(it => {
                let name = typeof it.productName === 'object'
                    ? (it.productName?.en || it.productName?.gu || Object.values(it.productName || {})[0])
                    : String(it.productName || '');
                
                const dbProd = prodMap.get(it.productId);
                if (dbProd && dbProd.name) {
                    const full = dbProd.name?.en || dbProd.name?.gu || Object.values(dbProd.name || {})[0];
                    if (full) name = full;
                }
                return {
                    ...it,
                    productName: name || 'Product'
                };
            });

            let totalOrderValue = 0;

            items.forEach((it, idx) => {
                const hasBatch = Boolean(it.batchNumber);
                const curRowHeight = hasBatch ? 28 : 22;

                // Page overflow check
                if (currentY + curRowHeight > pageHeight - 80) {
                    doc.addPage();
                    currentY = 25;
                    doc.rect(margin, currentY, contentWidth, thHeight).fill(primaryColor);
                    doc.fillColor('#ffffff').fontSize(7.5).font('Helvetica-Bold');
                    doc.text('SR.', margin + 5, currentY + 6, { width: 25, align: 'center' });
                    doc.text('PRODUCT DESCRIPTION', margin + 35, currentY + 6, { width: 210 });
                    doc.text('PACKING', margin + 250, currentY + 6, { width: 95, align: 'center' });
                    doc.text('PRICE (Rs.)', margin + 350, currentY + 6, { width: 60, align: 'right' });
                    doc.text('QTY', margin + 415, currentY + 6, { width: 35, align: 'center' });
                    doc.text('TOTAL (Rs.)', margin + 455, currentY + 6, { width: 85, align: 'right' });
                    currentY += thHeight;
                }

                const isEven = idx % 2 === 0;
                doc.rect(margin, currentY, contentWidth, curRowHeight).fillAndStroke(isEven ? '#ffffff' : altRowBg, '#e5e2da');

                doc.fillColor('#333333').fontSize(8).font('Helvetica');
                doc.text(String(idx + 1), margin + 5, currentY + (hasBatch ? 8 : 6), { width: 25, align: 'center' });
                
                const pName = typeof it.productName === 'object' 
                    ? (it.productName?.en || it.productName?.gu || 'Product') 
                    : String(it.productName || 'Product');
                
                doc.fillColor(primaryColor).font('Helvetica-Bold').fontSize(8).text(pName, margin + 35, currentY + 4, { width: 210, ellipsis: true });

                if (hasBatch) {
                    let expStr = '';
                    if (it.expiryDate) {
                        expStr = ` (Exp: ${new Date(it.expiryDate).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })})`;
                    }
                    doc.fillColor('#b45309').font('Helvetica-Bold').fontSize(6.5).text(`Batch: ${it.batchNumber}${expStr}`, margin + 35, currentY + 15, { width: 210, ellipsis: true });
                }
                
                const packingStr = String(it.volume || it.unitLabel || '15 Unit/Carton');
                doc.fillColor('#555555').font('Helvetica').fontSize(8).text(packingStr, margin + 250, currentY + (hasBatch ? 8 : 6), { width: 95, align: 'center', ellipsis: true });
                
                const unitPrice = Number(it.quotationPrice || it.purchasePrice || 0);
                doc.text(unitPrice ? unitPrice.toFixed(2) : '-', margin + 350, currentY + (hasBatch ? 8 : 6), { width: 60, align: 'right' });
                
                const qtyVal = Number(it.qty || 0);
                doc.fillColor(primaryColor).font('Helvetica-Bold').fontSize(8).text(String(qtyVal), margin + 415, currentY + (hasBatch ? 8 : 6), { width: 35, align: 'center' });
                
                const rowTotal = unitPrice * qtyVal;
                totalOrderValue += rowTotal;
                doc.text(rowTotal ? rowTotal.toFixed(2) : '-', margin + 455, currentY + (hasBatch ? 8 : 6), { width: 85, align: 'right' });

                currentY += curRowHeight;
            });

            currentY += 10;

            // ── Total Order Value Box ────────────────────────────────────────
            const totalBoxHeight = 30;
            doc.rect(margin, currentY, contentWidth, totalBoxHeight).fillAndStroke('#ffffff', borderColor);
            doc.fillColor(primaryColor).fontSize(11).font('Helvetica-Bold').text('TOTAL ORDER VALUE', margin + 15, currentY + 9);

            const totalDarkWidth = 180;
            doc.rect(pageWidth - margin - totalDarkWidth, currentY, totalDarkWidth, totalBoxHeight).fill(primaryColor);
            
            const formattedTotal = `Rs. ${totalOrderValue.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
            doc.fillColor('#ffffff').fontSize(15).font('Helvetica-Bold').text(formattedTotal, pageWidth - margin - totalDarkWidth, currentY + 8, { width: totalDarkWidth - 15, align: 'right' });

            currentY += totalBoxHeight + 15;

            // ── Footer / Signature ──────────────────────────────────────────
            const footerBoxHeight = 45;
            doc.rect(margin, currentY, contentWidth, footerBoxHeight).fillAndStroke('#ffffff', borderColor);

            if (order.note) {
                doc.fillColor('#555555').fontSize(7.5).font('Helvetica-Oblique').text(`Remarks: ${order.note}`, margin + 10, currentY + 10, { width: 300 });
            }
            doc.fillColor('#888888').fontSize(6.5).font('Helvetica').text('Computer Generated Vendor Order | Apna Tobacco', margin + 10, currentY + 28);

            doc.fillColor(primaryColor).fontSize(7.5).font('Helvetica-Bold').text('ORDER CREATOR SIGNATURE', pageWidth - margin - 180, currentY + 10, { width: 170, align: 'right' });
            doc.strokeColor('#888888').lineWidth(1).moveTo(pageWidth - margin - 150, currentY + 34).lineTo(pageWidth - margin - 10, currentY + 34).stroke();

            doc.end();
        } catch (err) {
            reject(err);
        }
    });
};

/**
 * Generates a professional Delivery Label PDF (A4 Format)
 * @param {Object} order - Order object with user and assignment details
 * @returns {Promise<Buffer>} - PDF Buffer
 */
export const generateDeliveryLabel = async (order) => {
    return new Promise((resolve, reject) => {
        try {
            // Standard 80mm width = 226pt
            const pageWidth = 226;
            const items = sortItemsByBoxNumber(order.items || []);
            const estimatedHeight = 350 + (items.length * 30);
            
            const doc = new PDFKitNative({ 
                size: [pageWidth, Math.max(400, estimatedHeight)],
                margin: 0, // Manual margins for full control
                autoFirstPage: true
            });
            
            const buffers = [];
            doc.on('data', (chunk) => buffers.push(chunk));
            doc.on('end', () => resolve(Buffer.concat(buffers)));
            doc.on('error', (err) => reject(err));

            const canvasWidth = doc.page.width;
            let currentY = 15;

            // ── Header Area ──
            if (fs.existsSync(logoPath)) {
                doc.image(logoPath, (canvasWidth - 80) / 2, currentY, { height: 40 });
                currentY += 45;
            } else {
                doc.fillColor('#000000').fontSize(16).font('Helvetica-Bold').text('APNA TOBACCO', 0, currentY, { align: 'center', width: canvasWidth });
                currentY += 20;
            }
            
            doc.fontSize(8).font('Helvetica').fillColor('#64748b').text('PACKING & DELIVERY SLIP', 0, currentY, { align: 'center', width: canvasWidth });
            currentY += 15;

            // Separator
            doc.strokeColor('#e2e8f0').lineWidth(1).moveTo(20, currentY).lineTo(canvasWidth - 20, currentY).stroke();
            currentY += 10;

            // Order Header
            doc.fillColor('#000000').fontSize(9).font('Helvetica-Bold').text(`ID: ${order.orderId}`, 20, currentY);
            doc.fontSize(7).font('Helvetica').fillColor('#64748b').text(new Date(order.createdAt).toLocaleString('en-IN'), 20, currentY + 11);
            currentY += 30;

            // ── Customer Info (Boxed) ──
            doc.rect(15, currentY, canvasWidth - 30, 60).fillColor('#f1f5f9').fill();
            doc.fillColor('#475569').fontSize(6).font('Helvetica-Bold').text('DELIVER TO:', 22, currentY + 8);
            
            const cName = (order.customerName || order.user?.fullname || 'Guest').toUpperCase();
            doc.fillColor('#0f172a').fontSize(11).font('Helvetica-Bold').text(cName, 22, currentY + 16, { width: canvasWidth - 45, ellipsis: true });
            
            const addr = `${order.shippingAddress?.address || order.user?.address || '-'}, ${order.shippingAddress?.city || order.user?.city || ''}`;
            doc.fillColor('#475569').fontSize(7).font('Helvetica').text(addr, 22, currentY + 28, { width: canvasWidth - 45, height: 18 });
            
            const phone = order.customerNumber || order.user?.number || '-';
            doc.fillColor('#0f172a').fontSize(9).font('Helvetica-Bold').text(`TEL: ${phone}`, 22, currentY + 45);
            currentY += 75;

            // ── Items Table ──
            doc.fillColor('#0f172a').fontSize(7).font('Helvetica-Bold');
            doc.text('QTY', 20, currentY);
            doc.text('DESCRIPTION', 65, currentY);
            doc.text('TOTAL', canvasWidth - 55, currentY, { width: 35, align: 'right' });
            currentY += 10;
            doc.strokeColor('#000000').lineWidth(0.5).moveTo(20, currentY).lineTo(canvasWidth - 20, currentY).stroke();
            currentY += 8;

            const getLabel = (val) => {
                if (!val) return '';
                if (typeof val === 'object') {
                    return val.en || val.EN || val.eng || val.ENG || val.gu || val.GU || val.guj || val.GUJ || val.HN || Object.values(val)[0] || '';
                }
                return val;
            };

            items.forEach((it) => {
                const sellUnit = it.sellUnit || 'Base';
                const vInfo = it.variantInfo || {};
                const baseUnitId = it.variant?.baseUnitLabel || vInfo.baseUnitLabel;
                const isDando = baseUnitId === '3451fa71-7dbc-4a25-aae0-5f6fce472cc6' || String(baseUnitId).toLowerCase() === 'dando' || String(baseUnitId) === 'ડંડો';

                let displayQuantity = Number(it.quantity);
                let unitLabel = '';

                if (isDando && sellUnit !== 'Inner') {
                    const dbUPP = Number(it.variant?.baseUnitsPerPack || vInfo.baseUnitsPerPack || 0);
                    const bUPP = (dbUPP && dbUPP !== 1) ? dbUPP : 20;
                    const sVol = Number(it.variant?.sellingVolume || vInfo.sellingVolume || 1);
                    const multiplier = bUPP * sVol;

                    displayQuantity = displayQuantity * multiplier;
                    unitLabel = getLabel(vInfo.innerUnitLabel || 'Box');
                } else {
                    unitLabel = sellUnit === 'Inner' ? getLabel(vInfo.innerUnitLabel || 'Pcs') : getLabel(vInfo.baseUnitLabel || 'Pack');
                }
                
                // Qty & Unit
                doc.fillColor('#000000').fontSize(9).font('Helvetica-Bold').text(Math.round(displayQuantity), 20, currentY);
                doc.fontSize(6).font('Helvetica').fillColor('#64748b').text(unitLabel, 20, currentY + 9);
                
                // Item Name
                const pName = vInfo.productName || 'Product';
                const name = getLabel(pName);
                let vol = getLabel(vInfo.volume || '');
                const mainCategoryId = it.product?.mainCategoryId || it.product?.mainCategory?.id || '';
                const isCigaretteCategory = mainCategoryId === '47b5d282-9cd2-4656-a695-8c237b4b2bfb';

                if (isDando || isCigaretteCategory) {
                    vol = '';
                }
                const displayName = vol ? `(${vol}) ${name}` : name;
                doc.fillColor('#0f172a').fontSize(8).font('Helvetica-Bold').text(displayName, 65, currentY, { width: 100 });
                
                // Subtotal
                const sub = (it.price * it.quantity).toFixed(0);
                doc.fillColor('#0f172a').fontSize(9).font('Helvetica-Bold').text(`₹${sub}`, canvasWidth - 55, currentY, { width: 35, align: 'right' });
                
                currentY += 28;
            });

            // ── Totals Section ──
            currentY += 5;
            doc.strokeColor('#e2e8f0').dash(2, { space: 2 }).moveTo(20, currentY).lineTo(canvasWidth - 20, currentY).stroke().undash();
            currentY += 10;

            doc.fillColor('#64748b').fontSize(7).font('Helvetica').text('Payment Mode:', 20, currentY);
            doc.fillColor('#0f172a').font('Helvetica-Bold').text(order.paymentMethod || 'COD', canvasWidth - 70, currentY, { width: 50, align: 'right' });
            currentY += 12;

            doc.fillColor('#0f172a').fontSize(10).font('Helvetica-Bold').text('GRAND TOTAL:', 20, currentY);
            doc.fontSize(14).text(`₹${Number(order.totalAmount).toFixed(0)}`, canvasWidth - 80, currentY - 2, { width: 60, align: 'right' });
            currentY += 30;

            // Notes
            if (order.notes) {
                doc.rect(15, currentY, canvasWidth - 30, 30).fillColor('#fff1f2').fill();
                doc.fillColor('#e11d48').fontSize(6).font('Helvetica-Bold').text(`REMARK: ${order.notes}`, 22, currentY + 8, { width: canvasWidth - 45 });
                currentY += 40;
            }

            // ── Footer ──
            if (order.assignment?.deliveryBoy) {
                doc.fillColor('#64748b').fontSize(6).font('Helvetica-Bold').text('DELIVERY PERSON:', 20, currentY);
                doc.fillColor('#0f172a').fontSize(8).font('Helvetica-Bold').text(order.assignment.deliveryBoy.name, 20, currentY + 8);
                currentY += 25;
            }

            doc.fillColor('#94a3b8').fontSize(7).font('Helvetica').text('Thank you for your business!', 0, currentY + 10, { align: 'center', width: canvasWidth });
            doc.fontSize(5).text('Powered by Tobaco Wholesale Hub', 0, currentY + 18, { align: 'center', width: canvasWidth });

            doc.end();
        } catch (err) {
            reject(err);
        }
    });
};

/**
 * Generates a beautiful HTML/CSS based thermal receipt
 * @param {Object} order 
 * @returns {String} HTML String
 */
export const generateDeliveryLabelHTML = (order) => {
    const items = sortItemsByBoxNumber(order.items || []);
    const customerName = (order.customerName || order.user?.fullname || 'Guest').toUpperCase();
    const phone = order.customerNumber || order.user?.number || '-';
    const address = `${order.shippingAddress?.address || order.user?.address || '-'}, ${order.shippingAddress?.city || order.user?.city || ''}`;
    const dateStr = new Date(order.createdAt).toLocaleString('en-IN', {
        day: '2-digit', month: '2-digit', year: 'numeric',
        hour: '2-digit', minute: '2-digit', hour12: true
    });

    const itemsHtml = items.map(it => {
        const sellUnit = it.sellUnit || 'Base';
        const vInfo = it.variantInfo || {};
        
        // Strictly prioritize English, then Gujarati, then whatever is available
        const getLabel = (val) => {
            if (!val) return '';
            if (typeof val === 'object') {
                return val.en || val.EN || val.eng || val.ENG || val.gu || val.GU || val.guj || val.GUJ || val.HN || Object.values(val)[0] || '';
            }
            return val;
        };

        const baseUnitId = it.variant?.baseUnitLabel || vInfo.baseUnitLabel;
        const isDando = baseUnitId === '3451fa71-7dbc-4a25-aae0-5f6fce472cc6' || String(baseUnitId).toLowerCase() === 'dando' || String(baseUnitId) === 'ડંડો';

        let displayQuantity = Number(it.quantity);
        let unitLabel = '';

        if (isDando && sellUnit !== 'Inner') {
            const dbUPP = Number(it.variant?.baseUnitsPerPack || vInfo.baseUnitsPerPack || 0);
            const bUPP = (dbUPP && dbUPP !== 1) ? dbUPP : 20;
            const sVol = Number(it.variant?.sellingVolume || vInfo.sellingVolume || 1);
            const multiplier = bUPP * sVol;

            displayQuantity = displayQuantity * multiplier;
            unitLabel = getLabel(vInfo.innerUnitLabel || 'Box');
        } else {
            unitLabel = sellUnit === 'Inner' ? getLabel(vInfo.innerUnitLabel || 'Pcs') : getLabel(vInfo.baseUnitLabel || 'Pack');
        }

        const pName = getLabel(vInfo.productName || 'Product');
        let vol = getLabel(vInfo.volume || '');
        const mainCategoryId = it.product?.mainCategoryId || it.product?.mainCategory?.id || '';
        const isCigaretteCategory = mainCategoryId === '47b5d282-9cd2-4656-a695-8c237b4b2bfb';

        if (isDando || isCigaretteCategory) {
            vol = '';
        }
        const sub = (it.price * it.quantity).toFixed(0);

        // Hide volume if it's redundant (e.g. if vol is "1 Dando" and unit is "Dando")
        const isVolRedundant = vol.toLowerCase().includes(unitLabel.toLowerCase());
        const displayVol = isVolRedundant ? '' : vol;

        return `
            <div class="item-entry">
                <div class="item-main">
                    <span class="item-name">${displayVol ? `(${displayVol}) ` : ''}${pName}</span>
                    <span class="item-price">₹${sub}</span>
                </div>
                <div class="item-sub">
                    <span class="item-qty">${Math.round(displayQuantity)} ${unitLabel}</span>
                </div>
            </div>
        `;
    }).join('');

    return `
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="UTF-8">
        <style>
            @page { size: 80mm auto; margin: 0; }
            * { box-sizing: border-box; }
            body { 
                width: 80mm; 
                margin: 0; 
                padding: 5mm; 
                font-family: 'Courier New', Courier, monospace; 
                font-size: 14px; 
                line-height: 1.2;
                color: #000;
                background: #fff;
            }
            .receipt { width: 100%; }
            .center { text-align: center; }
            .bold { font-weight: bold; }
            
            .header { margin-bottom: 15px; }
            .brand { font-size: 22px; font-weight: 900; letter-spacing: 1px; }
            .subtitle { font-size: 12px; margin-top: 2px; }
            
            .info-line { display: flex; justify-content: space-between; font-size: 12px; margin-bottom: 2px; }
            
            .separator { border-bottom: 1px dashed #000; margin: 10px 0; }
            
            .customer-section { margin-bottom: 15px; border: 1px solid #000; padding: 5px; }
            .cust-label { font-size: 10px; text-decoration: underline; margin-bottom: 3px; }
            .cust-name { font-size: 16px; font-weight: bold; margin-bottom: 2px; }
            .cust-addr { font-size: 12px; margin-bottom: 3px; }
            
            .items-header { display: flex; justify-content: space-between; font-weight: bold; border-bottom: 1px solid #000; padding-bottom: 3px; margin-bottom: 8px; }
            
            .item-entry { margin-bottom: 10px; }
            .item-main { display: flex; justify-content: space-between; font-weight: bold; font-size: 15px; }
            .item-sub { display: flex; justify-content: space-between; font-size: 12px; color: #333; margin-top: 1px; }
            .item-qty { font-style: italic; }
            
            .totals { margin-top: 10px; }
            .total-row { display: flex; justify-content: space-between; font-size: 14px; margin-bottom: 3px; }
            .grand-total { border-top: 1px solid #000; border-bottom: 1px solid #000; padding: 5px 0; margin-top: 5px; font-size: 18px; font-weight: bold; }
            
            .remark { margin-top: 10px; font-size: 12px; font-style: italic; border: 1px solid #000; padding: 5px; }
            
            .footer { margin-top: 20px; font-size: 12px; }
            
            @media print {
                body { width: 100%; padding: 4mm; }
            }
        </style>
    </head>
    <body>
        <div class="receipt">
            <div class="header center">
                <div class="brand">APNA TOBACCO</div>
                <div class="subtitle">--- EXPRESS DELIVERY ---</div>
            </div>
            
            <div class="info-line">
                <span>ORDER: ${order.orderId}</span>
                <span>${dateStr}</span>
            </div>
            
            <div class="separator"></div>
            
            <div class="customer-section">
                <div class="cust-label">DELIVER TO:</div>
                <div class="cust-name">${customerName}</div>
                <div class="cust-addr">${address}</div>
                <div class="bold">TEL: ${phone}</div>
            </div>
            
            <div class="items-header">
                <span>DESCRIPTION</span>
                <span>TOTAL</span>
            </div>
            
            <div class="items-list">
                ${itemsHtml}
            </div>
            
            <div class="separator"></div>
            
            <div class="totals">
                <div class="total-row">
                    <span>Payment Mode:</span>
                    <span class="bold">${order.paymentMethod || 'COD'}</span>
                </div>
                <div class="total-row grand-total">
                    <span>NET PAYABLE</span>
                    <span>₹${Number(order.totalAmount).toFixed(0)}</span>
                </div>
            </div>
            
            ${order.notes ? `
            <div class="remark">
                <span class="bold">NOTE:</span> ${order.notes}
            </div>
            ` : ''}
            
            <div class="footer center">
                <div class="bold">Delivery By: ${order.assignment?.deliveryBoy?.name || '__________'}</div>
                <p>**************************</p>
                <p>THANK YOU FOR SHOPPING!</p>
                <p>**************************</p>
            </div>
        </div>
        
        <script>
            window.onload = function() {
                window.print();
            };
        </script>
    </body>
    </html>
    `;
};
