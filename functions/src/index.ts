import * as admin from 'firebase-admin'
import * as functions from 'firebase-functions'

admin.initializeApp(functions.config().firebase)

export const removeCommentsOnOfferRemove = functions.firestore
  .document('offers/{id}')
  .onDelete(async (doc) => {
    const { docs } = await admin
      .firestore()
      .collection('comments')
      .where('itemId', '==', doc.id)
      .get()

    await Promise.all(
      docs.map(({ id }) =>
        admin.firestore().collection('comments').doc(id).delete()
      )
    )
  })

export const removeCommentsOnRequestRemove = functions.firestore
  .document('requests/{id}')
  .onDelete(async (doc) => {
    const { docs } = await admin
      .firestore()
      .collection('comments')
      .where('itemId', '==', doc.id)
      .get()

    await Promise.all(
      docs.map(({ id }) =>
        admin.firestore().collection('comments').doc(id).delete()
      )
    )
  })
