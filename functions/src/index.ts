import * as admin from 'firebase-admin'
import * as functions from 'firebase-functions'

admin.initializeApp(functions.config().firebase)

export const removeCommentsOnOfferRemove = functions.firestore
  .document('offers/{id}')
  .onDelete(async (doc) => {
    const docs = await admin
      .firestore()
      .collection('comments')
      .where('itemId', '==', doc.id)
      .get()

    const batch = admin.firestore().batch()

    docs.forEach(({ ref }) => batch.delete(ref))

    await batch.commit()
  })

export const removeCommentsOnRequestRemove = functions.firestore
  .document('requests/{id}')
  .onDelete(async (doc) => {
    const docs = await admin
      .firestore()
      .collection('comments')
      .where('itemId', '==', doc.id)
      .get()

    const batch = admin.firestore().batch()

    docs.forEach(({ ref }) => batch.delete(ref))

    await batch.commit()
  })
