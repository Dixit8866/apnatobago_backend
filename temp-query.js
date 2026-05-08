import db from './config/db.js';

async function seed() {
    try {
        // Clear any old payment transactions to avoid conflicts
        await db.query("DELETE FROM order_payments;");
        
        const orders = [
            {
                id: '5973b81e-a8ce-489d-9f3c-22ce2a06cd80',
                amount: 179.70,
                method: 'CASH',
                dbId: 'cc519b43-8f4e-4551-9ab6-e131f72a709a',
                isSubmitted: false,
                txId: null,
                notes: 'Collected cash at doorstep.'
            },
            {
                id: '5465d2cf-46aa-4d74-8e49-ea4cc29099a0',
                amount: 22.95,
                method: 'ONLINE',
                dbId: null,
                isSubmitted: true,
                txId: 'TXN_98741029312',
                notes: 'Razorpay online gateway payment'
            },
            {
                id: '3fb16b0a-895a-4f0e-a466-fde10a566957',
                amount: 114.75,
                method: 'CREDIT',
                dbId: null,
                isSubmitted: true,
                txId: 'CR_7739410312',
                notes: 'Outstanding vendor credit line updated.'
            }
        ];

        for (const o of orders) {
            const query = `
                INSERT INTO order_payments (
                    "id", "orderId", "deliveryBoyId", "amount", "paymentMethod", "transactionId", "notes", "isSubmitted", "submittedAt", "createdAt", "updatedAt"
                ) VALUES (
                    gen_random_uuid(), :orderId, :dbId, :amount, :method, :txId, :notes, :isSubmitted, :submittedAt, NOW(), NOW()
                );
            `;
            
            await db.query(query, {
                replacements: {
                    orderId: o.id,
                    dbId: o.dbId,
                    amount: o.amount,
                    method: o.method,
                    txId: o.txId,
                    notes: o.notes,
                    isSubmitted: o.isSubmitted,
                    submittedAt: o.isSubmitted ? new Date() : null
                }
            });
        }
        
        console.log("Order payments successfully seeded with real order references!");
    } catch(e) {
        console.error("Seeding error:", e.message);
    } finally {
        process.exit();
    }
}
seed();
