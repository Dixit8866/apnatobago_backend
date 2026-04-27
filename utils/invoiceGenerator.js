import PDFDocument from 'pdfkit-table';
import PDFKitNative from 'pdfkit';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const logoPath = path.join(__dirname, '..', 'assets', 'logo.png');

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

            // Bill To
            doc.fillColor('#64748b').fontSize(7).font('Helvetica-Bold').text('BILL TO / CUSTOMER:', 25, startY);
            doc.fillColor('#000000').fontSize(14).font('Helvetica-Bold').text(String(order.user?.fullname || 'Customer').toUpperCase(), 25, startY + 10);
            
            doc.fontSize(7).font('Helvetica-Bold').text('ADDRESS:', 25, startY + 28);
            doc.font('Helvetica').fontSize(8).fillColor('#334155')
               .text(`${order.address || order.shippingAddress?.address || '-'}, ${order.user?.city || '-'}`, 25, startY + 36, { width: width / 1.7 });

            doc.fontSize(7).font('Helvetica-Bold').text('TEL:', 25, startY + 58);
            doc.fontSize(12).text(order.user?.number || '-', 25, startY + 66);

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
            const items = order.items || [];
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
                        nameStr = pName.EN || pName.en || pName.GU || pName.gu || Object.values(pName)[0] || 'Product';
                    } else {
                        nameStr = String(pName);
                    }
                }
                const volume = it.variant?.volume || it.variantInfo?.volume || '';
                
                // Determine unit label (pcs vs carton)
                const sellUnit = it.sellUnit || 'Base';
                const vInfo = it.variantInfo || {};
                const unitLabel = sellUnit === 'Inner' ? (vInfo.innerUnitLabel || 'Pcs') : (vInfo.baseUnitLabel || 'Carton');
                
                doc.font('Helvetica').text(`${nameStr} (${volume})`, 60, itemY, { width: width - 250 });
                doc.text(`₹${Number(it.price).toFixed(2)}`, doc.page.width - 180, itemY, { width: 50, align: 'right' });
                doc.text(`${it.quantity} ${unitLabel}`, doc.page.width - 120, itemY, { width: 45, align: 'center' });
                doc.font('Helvetica-Bold').text(`₹${(it.price * it.quantity).toFixed(2)}`, doc.page.width - 85, itemY, { width: 60, align: 'right' });
                
                subtotal += it.price * it.quantity;
                itemY += 14;
            });

            // ── Totals ────────────────────────────────────────────────────────
            const totalY = itemY + 10;
            doc.lineWidth(0.3).strokeColor('#cbd5e1').moveTo(doc.page.width - 150, totalY).lineTo(doc.page.width - 25, totalY).stroke();
            
            doc.fillColor('#64748b').fontSize(8).font('Helvetica-Bold').text('GRAND TOTAL:', doc.page.width - 150, totalY + 10);
            doc.fillColor('#0d9488').fontSize(14).text(`₹${Number(order.totalAmount).toFixed(2)}`, doc.page.width - 85, totalY + 8, { width: 60, align: 'right' });

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
            
            doc.fillColor('#64748b').fontSize(7).font('Helvetica').text('PURCHASE BILL / INWARD INVOICE', 25, 60);

            doc.fillColor('#000000').fontSize(8).font('Helvetica-Bold')
               .text('BILL NO:', 0, 25, { align: 'right', width: doc.page.width - 25 })
               .fontSize(12).text(bill.billNo, 0, 35, { align: 'right', width: doc.page.width - 25 });
            
            doc.lineWidth(0.3).strokeColor('#cbd5e1').moveTo(25, 75).lineTo(doc.page.width - 25, 75).stroke();

            // ── Details Grid ──────────────────────────────────────────────────
            const startY = 85;

            // Vendor Info
            doc.fillColor('#64748b').fontSize(7).font('Helvetica-Bold').text('PURCHASED FROM / VENDOR:', 25, startY);
            doc.fillColor('#000000').fontSize(14).font('Helvetica-Bold').text(String(bill.vendor?.companyName || bill.vendor?.name || 'Vendor').toUpperCase(), 25, startY + 10);
            
            doc.fontSize(7).font('Helvetica-Bold').text('VENDOR CONTACT:', 25, startY + 28);
            doc.font('Helvetica').fontSize(8).fillColor('#334155').text(`Tel: ${bill.vendor?.number || '-'}`, 25, startY + 36);

            doc.fontSize(7).font('Helvetica-Bold').text('RECEIVED AT:', 25, startY + 58);
            doc.fontSize(10).text(bill.godown?.name || '-', 25, startY + 66);

            // Bill Meta
            const metaX = doc.page.width - 160;
            doc.rect(metaX - 5, startY, 140, 75).lineWidth(0.3).strokeColor('#cbd5e1').stroke();
            
            doc.fontSize(7).font('Helvetica-Bold').fillColor('#64748b').text('BILL DATE:', metaX, startY + 8);
            doc.fontSize(9).fillColor('#000000').text(new Date(bill.receivedDate).toLocaleDateString('en-IN'), metaX + 50, startY + 8);
            
            doc.fontSize(7).font('Helvetica-Bold').fillColor('#64748b').text('ORDER REF:', metaX, startY + 23);
            doc.fontSize(9).fillColor('#000000').text(bill.vendorOrder?.orderNo || '-', metaX + 50, startY + 23);

            doc.fillColor('#64748b').fontSize(7).font('Helvetica-Bold').text('RECEIVED BY:', metaX, startY + 38);
            doc.fillColor('#000000').fontSize(9).text(bill.receiver?.name || '-', metaX + 50, startY + 38);

            // ── Table ─────────────────────────────────────────────────────────
            const tableY = startY + 95;
            doc.fillColor('#000000').rect(25, tableY, width, 18).fill();
            doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(7);
            doc.text('SR.', 30, tableY + 6);
            doc.text('PRODUCT DESCRIPTION', 60, tableY + 6);
            doc.text('P.PRICE', doc.page.width - 180, tableY + 6, { width: 50, align: 'right' });
            doc.text('QTY', doc.page.width - 120, tableY + 6, { width: 30, align: 'center' });
            doc.text('TOTAL', doc.page.width - 85, tableY + 6, { width: 60, align: 'right' });

            let itemY = tableY + 22;
            const items = bill.items || [];
            
            items.forEach((it, idx) => {
                if (itemY > doc.page.height - 150) return;

                if (idx % 2 === 1) {
                    doc.fillColor('#f8fafc').rect(25, itemY - 3, width, 14).fill();
                }
                
                doc.fillColor('#334155').font('Helvetica-Bold').fontSize(7);
                doc.text(`${idx + 1}.`, 30, itemY);
                
                const productName = it.productName || 'Product';
                doc.font('Helvetica').text(`${productName} (${it.volume || ''})`, 60, itemY, { width: width - 250 });
                doc.text(`₹${Number(it.purchasePrice).toFixed(2)}`, doc.page.width - 180, itemY, { width: 50, align: 'right' });
                doc.text(String(it.qty), doc.page.width - 120, itemY, { width: 30, align: 'center' });
                doc.font('Helvetica-Bold').text(`₹${(it.purchasePrice * it.qty).toFixed(2)}`, doc.page.width - 85, itemY, { width: 60, align: 'right' });
                
                itemY += 14;
            });

            // ── Totals ────────────────────────────────────────────────────────
            const totalY = itemY + 10;
            doc.lineWidth(0.3).strokeColor('#cbd5e1').moveTo(doc.page.width - 150, totalY).lineTo(doc.page.width - 25, totalY).stroke();
            
            doc.fillColor('#64748b').fontSize(8).font('Helvetica-Bold').text('TOTAL BILL VALUE:', doc.page.width - 150, totalY + 10);
            doc.fillColor('#0d9488').fontSize(14).text(`₹${Number(bill.totalAmount).toFixed(2)}`, doc.page.width - 85, totalY + 8, { width: 60, align: 'right' });

            // ── Footer ────────────────────────────────────────────────────────
            const footerY = doc.page.height - 100;
            doc.lineWidth(0.3).strokeColor('#cbd5e1').moveTo(25, footerY).lineTo(doc.page.width - 25, footerY).stroke();
            
            if (bill.note) {
                doc.fillColor('#334155').font('Helvetica-Bold').fontSize(7).text(`PURCHASE NOTE: ${bill.note}`, 25, footerY + 10);
            }

            doc.fillColor('#000000').fontSize(8).font('Helvetica-Bold').text('RECEIVER SIGNATURE', 0, footerY + 30, { align: 'right', width: doc.page.width - 25 });
            doc.text('____________________', 0, footerY + 45, { align: 'right', width: doc.page.width - 25 });

            doc.fontSize(6).fillColor('#94a3b8').text('Computer Generated Purchase Bill | Apna Tobacco', 0, doc.page.height - 40, { align: 'center', width: doc.page.width });

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
            const items = order.items || [];
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

            items.forEach((it) => {
                const sellUnit = it.sellUnit || 'Base';
                const vInfo = it.variantInfo || {};
                const unitLabel = sellUnit === 'Inner' ? (vInfo.innerUnitLabel || 'Pcs') : (vInfo.baseUnitLabel || 'Pack');
                
                // Qty & Unit
                doc.fillColor('#000000').fontSize(9).font('Helvetica-Bold').text(Math.round(it.quantity), 20, currentY);
                doc.fontSize(6).font('Helvetica').fillColor('#64748b').text(unitLabel, 20, currentY + 9);
                
                // Item Name
                const pName = vInfo.productName || 'Product';
                const name = typeof pName === 'object' ? (pName.en || Object.values(pName)[0]) : pName;
                const vol = vInfo.volume || '';
                doc.fillColor('#0f172a').fontSize(8).font('Helvetica-Bold').text(name, 65, currentY, { width: 100 });
                doc.fontSize(7).font('Helvetica').fillColor('#64748b').text(vol, 65, currentY + 9);
                
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
    const items = order.items || [];
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
                return val.en || val.en || val.gu || val.HN || Object.values(val)[0] || '';
            }
            return val;
        };

        const unitLabel = sellUnit === 'Inner' ? getLabel(vInfo.innerUnitLabel || 'Pcs') : getLabel(vInfo.baseUnitLabel || 'Pack');
        const pName = getLabel(vInfo.productName || 'Product');
        const vol = getLabel(vInfo.volume || '');
        const sub = (it.price * it.quantity).toFixed(0);

        // Hide volume if it's redundant (e.g. if vol is "1 Dando" and unit is "Dando")
        const isVolRedundant = vol.toLowerCase().includes(unitLabel.toLowerCase());
        const displayVol = isVolRedundant ? '' : vol;

        return `
            <div class="item-entry">
                <div class="item-main">
                    <span class="item-name">${pName}</span>
                    <span class="item-price">₹${sub}</span>
                </div>
                <div class="item-sub">
                    <span class="item-qty">${Math.round(it.quantity)} ${unitLabel}</span>
                    <span class="item-vol">${displayVol}</span>
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
                font-size: 12px; 
                line-height: 1.2;
                color: #000;
                background: #fff;
            }
            .receipt { width: 100%; }
            .center { text-align: center; }
            .bold { font-weight: bold; }
            
            .header { margin-bottom: 15px; }
            .brand { font-size: 20px; font-weight: 900; letter-spacing: 1px; }
            .subtitle { font-size: 10px; margin-top: 2px; }
            
            .info-line { display: flex; justify-content: space-between; font-size: 10px; margin-bottom: 2px; }
            
            .separator { border-bottom: 1px dashed #000; margin: 10px 0; }
            
            .customer-section { margin-bottom: 15px; border: 1px solid #000; padding: 5px; }
            .cust-label { font-size: 8px; text-decoration: underline; margin-bottom: 3px; }
            .cust-name { font-size: 14px; font-weight: bold; margin-bottom: 2px; }
            .cust-addr { font-size: 10px; margin-bottom: 3px; }
            
            .items-header { display: flex; justify-content: space-between; font-weight: bold; border-bottom: 1px solid #000; padding-bottom: 3px; margin-bottom: 8px; }
            
            .item-entry { margin-bottom: 10px; }
            .item-main { display: flex; justify-content: space-between; font-weight: bold; font-size: 13px; }
            .item-sub { display: flex; justify-content: space-between; font-size: 10px; color: #333; margin-top: 1px; }
            .item-qty { font-style: italic; }
            
            .totals { margin-top: 10px; }
            .total-row { display: flex; justify-content: space-between; font-size: 12px; margin-bottom: 3px; }
            .grand-total { border-top: 1px solid #000; border-bottom: 1px solid #000; padding: 5px 0; margin-top: 5px; font-size: 16px; font-weight: bold; }
            
            .remark { margin-top: 10px; font-size: 10px; font-style: italic; border: 1px solid #000; padding: 5px; }
            
            .footer { margin-top: 20px; font-size: 10px; }
            
            @media print {
                body { width: 100%; padding: 2mm; }
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
