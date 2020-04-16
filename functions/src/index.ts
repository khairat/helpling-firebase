import * as admin from 'firebase-admin'
import * as functions from 'firebase-functions'

admin.initializeApp(functions.config().firebase)

const removeComments = async (itemId: string): Promise<void> => {
  const docs = await admin
    .firestore()
    .collection('comments')
    .where('itemId', '==', itemId)
    .get()

  const batch = admin.firestore().batch()

  docs.forEach(({ ref }) => batch.delete(ref))

  await batch.commit()
}

export const accept = functions.https.onCall(async ({ id, kind }, { auth }) => {
  if (!auth) {
    throw new functions.https.HttpsError(
      'unauthenticated',
      'Need to be authenticated.'
    )
  }

  const item = await admin.firestore().collection(`${kind}s`).doc(id).get()

  const data = item.data()

  if (!data) {
    throw new functions.https.HttpsError(
      'not-found',
      `${kind === 'offer' ? 'Offer' : 'Request'} not found.`
    )
  }

  const { status, userId } = data

  if (auth.uid === userId) {
    throw new functions.https.HttpsError(
      'permission-denied',
      `You cannot accept your own ${kind}.`
    )
  }

  if (['accepted', 'completed'].includes(status)) {
    throw new functions.https.HttpsError('invalid-argument', 'Invalid status')
  }

  const thread = await admin
    .firestore()
    .collection('threads')
    .add({
      createdAt: new Date(),
      itemId: item.id,
      itemType: kind,
      updatedAt: new Date(),
      userIds: [userId, auth.uid]
    })

  await admin.firestore().collection(`${kind}s`).doc(id).update({
    helplingId: auth.uid,
    status: 'accepted',
    threadId: thread.id,
    updatedAt: new Date()
  })

  return {
    threadId: thread.id
  }
})

export const complete = functions.https.onCall(
  async ({ id, kind }, { auth }) => {
    if (!auth) {
      throw new functions.https.HttpsError(
        'unauthenticated',
        'Need to be authenticated.'
      )
    }

    const item = await admin.firestore().collection(`${kind}s`).doc(id).get()

    const data = item.data()

    if (!data) {
      throw new functions.https.HttpsError(
        'not-found',
        `${kind === 'offer' ? 'Offer' : 'Request'} not found.`
      )
    }

    const { helplingId, status, userId } = data

    if (auth.uid === userId) {
      throw new functions.https.HttpsError(
        'permission-denied',
        `You cannot complete your own ${kind}.`
      )
    }

    if (auth.uid !== helplingId) {
      throw new functions.https.HttpsError(
        'permission-denied',
        `You cannot complete someone else's ${kind}.`
      )
    }

    if (['pending', 'completed'].includes(status)) {
      throw new functions.https.HttpsError('invalid-argument', 'Invalid status')
    }

    await admin.firestore().collection(`${kind}s`).doc(id).update({
      status: 'completed'
    })
  }
)

export const removeCommentsOnOfferRemove = functions.firestore
  .document('offers/{id}')
  .onDelete((doc) => removeComments(doc.id))

export const removeCommentsOnRequestRemove = functions.firestore
  .document('requests/{id}')
  .onDelete((doc) => removeComments(doc.id))

export const updateThreadOnMessageCreate = functions.firestore
  .document('messages/{id}')
  .onCreate(async (doc) => {
    const data = doc.data()

    if (data) {
      const { body, threadId } = data

      await admin.firestore().collection('threads').doc(threadId).update({
        last: body,
        updatedAt: new Date()
      })
    }
  })
